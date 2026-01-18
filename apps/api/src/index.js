import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, statSync } from 'fs';
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import makeWASocket,{useMultiFileAuthState} from "@whiskeysockets/baileys";
import PQueue from "p-queue";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const queue = new PQueue({interval:2000, intervalCap:1});
const instances = new Map();

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.sendStatus(401);
  try{
    req.user=jwt.verify(h.replace("Bearer ",""), process.env.JWT_SECRET);
    next();
  }catch{ res.sendStatus(401);}
}

app.post("/auth/register", async (req,res)=>{
  const u=await prisma.user.create({data:req.body});
  res.json(u);
});

app.post("/auth/login", async (req,res)=>{
  const u=await prisma.user.findUnique({where:{email:req.body.email}});
  if(!u) return res.sendStatus(401);
  const t=jwt.sign({id:u.id}, process.env.JWT_SECRET,{expiresIn:"7d"});
  res.json({token:t});
});

app.post("/instances", auth, async (req,res)=>{
  const inst=await prisma.instance.create({data:{name:req.body.name,userId:req.user.id}});
  const {state, saveCreds}=await useMultiFileAuthState(`sessions/${inst.id}`);
  const sock=makeWASocket({auth:state});
  sock.ev.on("creds.update", saveCreds);
  instances.set(inst.id, sock);
  res.json(inst);
});

app.post("/send", auth, async (req,res)=>{
  const {instanceId, phone, text}=req.body;
  const sock=instances.get(instanceId);
  await queue.add(()=>sock.sendMessage(phone+"@s.whatsapp.net",{text}));
  res.json({ok:true});
});

// Scheduler
setInterval(async ()=>{
  const jobs=await prisma.schedule.findMany({where:{sent:false, sendAt:{lte:new Date()}}});
  for(const j of jobs){
    const sock=instances.get(j.instanceId);
    if(!sock) continue;
    await sock.sendMessage(j.phone+"@s.whatsapp.net",{text:j.text});
    await prisma.schedule.update({where:{id:j.id}, data:{sent:true}});
  }
},5000);

// Debug endpoint para verificar estrutura de arquivos
app.get("/debug-files", (req, res) => {
  const webDir = path.join(__dirname, '../../web');
  const nextDir = path.join(webDir, '.next');
  
  function listFiles(dir, prefix = '') {
    let result = [];
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          result.push(`${prefix}📁 ${item}/`);
          result = result.concat(listFiles(fullPath, prefix + '  '));
        } else {
          result.push(`${prefix}📄 ${item}`);
        }
      }
    } catch (error) {
      result.push(`${prefix}❌ ${error.message}`);
    }
    return result;
  }
  
  const files = listFiles(nextDir);
  res.json({
    webDir,
    nextDir,
    exists: existsSync(nextDir),
    files: files
  });
});

// Serve Next.js build - primeiro tente várias possibilidades
const webDir = path.join(__dirname, '../../web');

// Tente encontrar os arquivos estáticos
const possibleStaticDirs = [
  path.join(webDir, '.next/static'),
  path.join(webDir, '.next/_next/static'),
  path.join(webDir, 'out/_next/static'),
  path.join(webDir, 'out/static')
];

for (const staticDir of possibleStaticDirs) {
  if (existsSync(staticDir)) {
    console.log(`Serving static files from: ${staticDir}`);
    app.use(express.static(staticDir));
  }
}

// Serve arquivos públicos
const publicDir = path.join(webDir, 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Rota para todas as páginas - tente múltiplos locais
app.get("*", (req, res) => {
  // Verifica se é uma rota de API
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Possíveis locais dos arquivos HTML
  const possibleHtmlLocations = [
    // Next.js 12+ Pages Router
    path.join(webDir, '.next/server/pages'),
    // Next.js 13+ App Router
    path.join(webDir, '.next/server/app'),
    // Next.js standalone output
    path.join(webDir, '.next/server'),
    // Next.js export
    path.join(webDir, 'out'),
    // Build normal
    path.join(webDir, 'build')
  ];
  
  let htmlFile = null;
  
  for (const basePath of possibleHtmlLocations) {
    if (!existsSync(basePath)) continue;
    
    let filePath;
    
    if (req.path === '/') {
      filePath = path.join(basePath, 'index.html');
    } else {
      // Remove trailing slash if present
      const cleanPath = req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
      
      // Tenta .html primeiro
      filePath = path.join(basePath, `${cleanPath}.html`);
      
      // Se não existir, tenta /index.html
      if (!existsSync(filePath)) {
        filePath = path.join(basePath, cleanPath, 'index.html');
      }
    }
    
    if (existsSync(filePath)) {
      htmlFile = filePath;
      break;
    }
  }
  
  if (htmlFile) {
    console.log(`Serving HTML from: ${htmlFile}`);
    return res.sendFile(htmlFile);
  }
  
  // Fallback: se não encontrou, tenta servir um HTML básico
  console.log('No HTML file found, serving fallback');
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>WhatsApp SaaS</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .container { max-width: 800px; margin: 0 auto; }
          .debug-link { margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>WhatsApp SaaS Dashboard</h1>
          <p>Backend está funcionando, mas os arquivos do frontend não foram encontrados.</p>
          <p>Verifique: <a href="/debug-files" target="_blank">/debug-files</a></p>
          <div class="debug-link">
            <a href="/debug-files">Ver estrutura de arquivos</a>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.listen(3000,()=>console.log("SaaS running on 3000"));
