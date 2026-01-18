import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, statSync } from 'fs';
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import makeWASocket, { useMultiFileAuthState } from "baileys";
import PQueue from "p-queue";
import qrcode from 'qrcode';

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

// ============ ENDPOINTS DE API ============

// Status da API
app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    service: "WhatsApp SaaS API",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    instances: instances.size,
    environment: process.env.NODE_ENV || "development"
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Versão
app.get("/api/version", (req, res) => {
  res.json({
    version: "1.0.0",
    name: "WhatsApp SaaS",
    description: "API para envio de mensagens via WhatsApp"
  });
});

// Lista endpoints
app.get("/api", (req, res) => {
  const endpoints = [
    { method: "GET", path: "/api", description: "Lista de endpoints" },
    { method: "GET", path: "/api/status", description: "Status da API" },
    { method: "GET", path: "/api/health", description: "Health check" },
    { method: "GET", path: "/api/version", description: "Versão da API" },
    { method: "GET", path: "/api/debug-files", description: "Debug: estrutura de arquivos" },
    { method: "GET", path: "/api/instances/:id/qr", description: "Obter QR code da instância" },
    { method: "POST", path: "/api/auth/register", description: "Registrar usuário" },
    { method: "POST", path: "/api/auth/login", description: "Login de usuário" },
    { method: "POST", path: "/api/instances", description: "Criar instância WhatsApp (auth required)" },
    { method: "GET", path: "/api/instances", description: "Listar minhas instâncias (auth required)" },
    { method: "POST", path: "/api/send", description: "Enviar mensagem (auth required)" }
  ];
  res.json({
    service: "WhatsApp SaaS API",
    baseUrl: req.protocol + "://" + req.get('host') + "/api",
    endpoints: endpoints
  });
});

// Registrar usuário
app.post("/api/auth/register", async (req,res)=>{
  try {
    const u=await prisma.user.create({data:req.body});
    res.json(u);
  } catch(error) {
    res.status(400).json({ error: error.message });
  }
});

// Login
app.post("/api/auth/login", async (req,res)=>{
  const u=await prisma.user.findUnique({where:{email:req.body.email}});
  if(!u) return res.sendStatus(401);
  const t=jwt.sign({id:u.id}, process.env.JWT_SECRET,{expiresIn:"7d"});
  res.json({token:t});
});

// Criar instância
app.post("/api/instances", auth, async (req,res)=>{
  try {
    const inst=await prisma.instance.create({data:{name:req.body.name,userId:req.user.id}});
    const {state, saveCreds}=await useMultiFileAuthState(`sessions/${inst.id}`);
    
    const sock=makeWASocket({
      auth: state,
      printQRInTerminal: false
    });
    
    // Listen for QR code
    sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        console.log(`QR code for instance ${inst.id}:`, update.qr);
        // Store QR temporarily (in production, use Redis or similar)
        sock.qrCode = update.qr;
      }
      if (update.connection === 'open') {
        console.log(`Instance ${inst.id} connected!`);
        sock.isConnected = true;
      }
    });
    
    sock.ev.on("creds.update", saveCreds);
    instances.set(inst.id, { sock, userId: req.user.id });
    
    res.json({
      id: inst.id,
      name: inst.name,
      status: 'pending_qr',
      message: 'Instance created. Get QR code at /api/instances/{id}/qr'
    });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar instâncias do usuário
app.get("/api/instances", auth, async (req, res) => {
  const userInstances = await prisma.instance.findMany({
    where: { userId: req.user.id }
  });
  
  // Adiciona status de conexão
  const instancesWithStatus = userInstances.map(inst => {
    const instanceData = instances.get(inst.id);
    return {
      ...inst,
      connectionStatus: instanceData?.sock.isConnected ? 'connected' : 'disconnected',
      hasQr: !!instanceData?.sock.qrCode
    };
  });
  
  res.json(instancesWithStatus);
});

// Obter QR code da instância
app.get("/api/instances/:id/qr", auth, async (req, res) => {
  const instanceId = req.params.id;
  const instanceData = instances.get(instanceId);
  
  if (!instanceData) {
    return res.status(404).json({ error: "Instance not found" });
  }
  
  if (instanceData.userId !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  
  if (instanceData.sock.qrCode) {
    try {
      // Gerar QR code como imagem PNG
      const qrImage = await qrcode.toDataURL(instanceData.sock.qrCode);
      res.json({
        qr: instanceData.sock.qrCode,
        qrImage: qrImage,
        status: 'qr_available',
        message: 'Scan this QR code with WhatsApp'
      });
    } catch (error) {
      res.json({
        qr: instanceData.sock.qrCode,
        status: 'qr_available',
        message: 'Scan this QR code with WhatsApp'
      });
    }
  } else if (instanceData.sock.isConnected) {
    res.json({
      status: 'connected',
      message: 'Instance is already connected to WhatsApp'
    });
  } else {
    res.json({
      status: 'waiting',
      message: 'Waiting for QR code generation...'
    });
  }
});

// Enviar mensagem
app.post("/api/send", auth, async (req,res)=>{
  const {instanceId, phone, text}=req.body;
  
  // Validação
  if (!instanceId || !phone || !text) {
    return res.status(400).json({ error: "Missing required fields: instanceId, phone, text" });
  }
  
  const instanceData = instances.get(instanceId);
  
  if (!instanceData) {
    return res.status(404).json({ error: "Instance not found" });
  }
  
  if (instanceData.userId !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  
  if (!instanceData.sock.isConnected) {
    return res.status(400).json({ error: "Instance not connected to WhatsApp" });
  }
  
  try {
    await queue.add(() => 
      instanceData.sock.sendMessage(`${phone}@s.whatsapp.net`, { text })
    );
    res.json({ok:true, message: "Message sent successfully"});
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// Scheduler para mensagens agendadas
setInterval(async ()=>{
  const jobs=await prisma.schedule.findMany({where:{sent:false, sendAt:{lte:new Date()}}});
  for(const j of jobs){
    const sock=instances.get(j.instanceId);
    if(!sock) continue;
    await sock.sendMessage(j.phone+"@s.whatsapp.net",{text:j.text});
    await prisma.schedule.update({where:{id:j.id}, data:{sent:true}});
  }
},5000);

// ============ DEBUG ENDPOINTS ============

// Debug endpoint para verificar estrutura de arquivos
app.get("/api/debug-files", (req, res) => {
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

// ============ SERVE FRONTEND ============

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

// ============ ROTA PARA FRONTEND ============

app.get("*", (req, res, next) => {
  // Se a rota começa com /api, não serve frontend
  if (req.path.startsWith('/api/')) {
    return next(); // Passa para os handlers de API
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
  
  // Fallback: se não encontrou, serve página de dashboard
  console.log('No HTML file found, serving dashboard');
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>WhatsApp SaaS Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 800px;
            width: 100%;
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%);
            color: white;
            padding: 40px;
            text-align: center;
          }
          .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
          }
          .header p {
            opacity: 0.9;
            font-size: 1.1rem;
          }
          .content {
            padding: 40px;
          }
          .status-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
          }
          .card {
            background: #f8fafc;
            border-radius: 15px;
            padding: 25px;
            border-left: 5px solid #3b82f6;
            transition: transform 0.3s, box-shadow 0.3s;
          }
          .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          }
          .card h3 {
            color: #1e40af;
            margin-bottom: 15px;
            font-size: 1.3rem;
          }
          .card p {
            color: #475569;
            line-height: 1.6;
          }
          .card ul {
            list-style: none;
            margin-top: 15px;
          }
          .card li {
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .card li:last-child {
            border-bottom: none;
          }
          .card a {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 500;
          }
          .card a:hover {
            text-decoration: underline;
          }
          .api-list {
            background: #f1f5f9;
            border-radius: 15px;
            padding: 30px;
            margin-top: 30px;
          }
          .api-list h3 {
            color: #1e40af;
            margin-bottom: 20px;
            font-size: 1.5rem;
          }
          .endpoint {
            background: white;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            border: 1px solid #e2e8f0;
          }
          .method {
            display: inline-block;
            padding: 5px 12px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 0.9rem;
            margin-right: 15px;
            min-width: 70px;
            text-align: center;
          }
          .method.get { background: #dbeafe; color: #1d4ed8; }
          .method.post { background: #dcfce7; color: #166534; }
          .path {
            font-family: 'Courier New', monospace;
            color: #475569;
            flex-grow: 1;
          }
          .test-btn {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: background 0.3s;
          }
          .test-btn:hover {
            background: #2563eb;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #64748b;
            font-size: 0.9rem;
            border-top: 1px solid #e2e8f0;
          }
        </style>
        <script>
          async function testEndpoint(endpoint) {
            try {
              const response = await fetch(endpoint);
              const data = await response.json();
              alert(JSON.stringify(data, null, 2));
            } catch (error) {
              alert('Error: ' + error.message);
            }
          }
          
          async function checkAllEndpoints() {
            const endpoints = [
              '/api/health',
              '/api/status',
              '/api/version',
              '/api/debug-files'
            ];
            
            const results = [];
            for (const endpoint of endpoints) {
              try {
                const response = await fetch(endpoint);
                results.push({
                  endpoint,
                  status: response.status,
                  ok: response.ok
                });
              } catch (error) {
                results.push({
                  endpoint,
                  error: error.message
                });
              }
            }
            
            alert('Test Results:\\n' + results.map(r => 
              r.error ? \`❌ \${r.endpoint}: \${r.error}\` : 
              r.ok ? \`✅ \${r.endpoint}: HTTP \${r.status}\` :
              \`⚠️  \${r.endpoint}: HTTP \${r.status}\`
            ).join('\\n'));
          }
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 WhatsApp SaaS</h1>
            <p>API Status Dashboard</p>
          </div>
          
          <div class="content">
            <div class="status-cards">
              <div class="card">
                <h3>📊 API Status</h3>
                <p>Verifique o status da API e seus endpoints</p>
                <ul>
                  <li><a href="/api/health" target="_blank">Health Check</a></li>
                  <li><a href="/api/status" target="_blank">Status Completo</a></li>
                  <li><a href="/api/version" target="_blank">Versão</a></li>
                </ul>
              </div>
              
              <div class="card">
                <h3>🔧 Debug Tools</h3>
                <p>Ferramentas para diagnóstico e solução de problemas</p>
                <ul>
                  <li><a href="/api/debug-files" target="_blank">Estrutura de Arquivos</a></li>
                  <li><button class="test-btn" onclick="checkAllEndpoints()">Testar Todos Endpoints</button></li>
                </ul>
              </div>
              
              <div class="card">
                <h3>📚 Documentação</h3>
                <p>Recursos e links úteis</p>
                <ul>
                  <li><a href="/api" target="_blank">Lista de Endpoints</a></li>
                  <li><a href="#" onclick="alert('Documentação em desenvolvimento')">API Docs</a></li>
                  <li><a href="https://github.com" target="_blank">GitHub</a></li>
                </ul>
              </div>
            </div>
            
            <div class="api-list">
              <h3>🌐 Endpoints da API</h3>
              
              <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api</span>
                <button class="test-btn" onclick="testEndpoint('/api')">Testar</button>
              </div>
              
              <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api/health</span>
                <button class="test-btn" onclick="testEndpoint('/api/health')">Testar</button>
              </div>
              
              <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api/status</span>
                <button class="test-btn" onclick="testEndpoint('/api/status')">Testar</button>
              </div>
              
              <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api/version</span>
                <button class="test-btn" onclick="testEndpoint('/api/version')">Testar</button>
              </div>
              
              <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/api/debug-files</span>
                <button class="test-btn" onclick="testEndpoint('/api/debug-files')">Testar</button>
              </div>
              
              <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/auth/register</span>
                <button class="test-btn" onclick="alert('Require POST request with JSON body')">Info</button>
              </div>
              
              <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/api/auth/login</span>
                <button class="test-btn" onclick="alert('Require POST request with JSON body')">Info</button>
              </div>
            </div>
          </div>
          
          <div class="footer">
            <p>WhatsApp SaaS Dashboard • Backend Online • ${new Date().toLocaleString()}</p>
            <p style="margin-top: 5px; font-size: 0.8rem;">Acesse diretamente os endpoints em /api/*</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.listen(3000,()=>console.log("SaaS running on 3000"));
