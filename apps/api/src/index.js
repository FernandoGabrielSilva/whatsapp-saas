import express from "express";
import path from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import makeWASocket,{useMultiFileAuthState} from "@whiskeysockets/baileys";
import PQueue from "p-queue";

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

// Serve Next.js build - CORRIGIDO
app.use(express.static("apps/web/.next/static"));
app.use(express.static("apps/web/public"));

// Rota para todas as páginas - CORRIGIDO
app.get("*", (req, res) => {
  // Verifica se é uma rota de API
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Tenta servir o arquivo HTML correspondente
  const filePath = path.join(
    process.cwd(),
    "apps/web/.next/server/pages",
    req.path === "/" ? "index.html" : `${req.path}.html`
  );
  
  // Fallback para index.html se o arquivo não existir (SPA)
  if (!require('fs').existsSync(filePath)) {
    return res.sendFile(path.join(process.cwd(), "apps/web/.next/server/pages/index.html"));
  }
  
  res.sendFile(filePath);
});

app.listen(3000,()=>console.log("SaaS running on 3000"));
