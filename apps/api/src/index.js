import express from "express";
import path from "path";
import jwt from "jsonwebtoken";
import qrcode from "qrcode";

import { PrismaClient } from "@prisma/client";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from "@whiskeysockets/baileys";
import PQueue from "p-queue";

import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync
} from "fs";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Garante que a pasta sessions existe
const sessionsDir = path.join(__dirname, '../../../sessions');
if (!existsSync(sessionsDir)) {
  mkdirSync(sessionsDir, { recursive: true });
  console.log(`Created sessions directory: ${sessionsDir}`);
}

const prisma = new PrismaClient();
const queue = new PQueue({interval:2000, intervalCap:1});
const instances = new Map();

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.sendStatus(401);
  try{
    req.user=jwt.verify(h.replace("Bearer ",""), process.env.JWT_SECRET || "default_secret_key");
    next();
  }catch(err){
    console.error("Auth error:", err);
    res.sendStatus(401);
  }
}

// Função para criar socket
async function createWhatsAppSocket(instanceId, sessionPath) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    // Busca a versão mais recente do WhatsApp Web
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WhatsApp Web version: ${version.join('.')}, isLatest: ${isLatest}`);
    
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, { log: console }),
      },
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      fireInitQueries: true,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => false,
      getMessage: async () => undefined,
      logger: console,
    });
    
    // Listen for QR code
    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      
      console.log(`Connection update for instance ${instanceId}:`, connection);
      
      if (qr) {
        console.log(`QR code generated for instance ${instanceId}`);
        sock.qrCode = qr;
        
        // Atualiza o mapa de instâncias
        const instanceData = instances.get(instanceId);
        if (instanceData) {
          instanceData.sock.qrCode = qr;
          instances.set(instanceId, instanceData);
        }
      }
      
      if (connection === 'open') {
        console.log(`✅ Instance ${instanceId} connected successfully!`);
        sock.isConnected = true;
        sock.qrCode = null;
        
        // Atualiza o mapa
        const instanceData = instances.get(instanceId);
        if (instanceData) {
          instanceData.sock.isConnected = true;
          instanceData.sock.qrCode = null;
          instances.set(instanceId, instanceData);
        }
      }
      
      if (connection === 'close') {
        console.log(`Instance ${instanceId} disconnected`);
        sock.isConnected = false;
        
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message;
        
        console.log(`Disconnect reason: ${statusCode}, ${errorMessage}`);
        
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`Will attempt to reconnect instance ${instanceId} in 5 seconds...`);
          
          // Tenta reconectar após 5 segundos
          setTimeout(async () => {
            try {
              console.log(`Attempting to reconnect instance ${instanceId}...`);
              const newSocket = await createWhatsAppSocket(instanceId, sessionPath);
              
              const instanceData = instances.get(instanceId);
              if (instanceData) {
                instanceData.sock = newSocket;
                instances.set(instanceId, instanceData);
                console.log(`Instance ${instanceId} reconnected`);
              }
            } catch (reconnectError) {
              console.error(`Failed to reconnect instance ${instanceId}:`, reconnectError);
            }
          }, 5000);
        } else {
          console.log(`Instance ${instanceId} logged out, removing from memory`);
          instances.delete(instanceId);
        }
      }
    });
    
    sock.ev.on("creds.update", saveCreds);
    
    // Adiciona tratamento de erros
    sock.ev.on('connection.give-up', () => {
      console.log(`Connection give up for instance ${instanceId}`);
    });
    
    sock.ev.on('connection.phone-change', (update) => {
      console.log(`Phone changed for instance ${instanceId}:`, update);
    });
    
    // Inicializa propriedades do socket
    sock.qrCode = null;
    sock.isConnected = false;
    sock.instanceId = instanceId;
    
    return sock;
  } catch (error) {
    console.error(`Error creating socket for instance ${instanceId}:`, error);
    throw error;
  }
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
    environment: process.env.NODE_ENV || "development",
    memoryUsage: process.memoryUsage()
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
    { method: "POST", path: "/api/send", description: "Enviar mensagem (auth required)" },
    { method: "POST", path: "/api/instances/:id/reconnect", description: "Reconectar instância (auth required)" },
    { method: "GET", path: "/api/debug/instances", description: "Debug: listar instâncias em memória" }
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
  const t=jwt.sign({id:u.id}, process.env.JWT_SECRET || "default_secret_key",{expiresIn:"7d"});
  res.json({token:t});
});

// Criar instância
app.post("/api/instances", auth, async (req,res)=>{
  try {
    const inst=await prisma.instance.create({data:{name:req.body.name,userId:req.user.id}});
    const sessionPath = `sessions/${inst.id}`;
    
    console.log(`Creating session at: ${sessionPath}`);
    
    const sock = await createWhatsAppSocket(inst.id, sessionPath);
    
    instances.set(inst.id, { 
      sock, 
      userId: req.user.id,
      lastUpdated: new Date(),
      sessionPath: sessionPath
    });
    
    console.log(`Instance created: ${inst.id}, total instances: ${instances.size}`);
    
    res.json({
      id: inst.id,
      name: inst.name,
      status: 'pending_qr',
      message: 'Instance created. Get QR code at /api/instances/{id}/qr',
      hasQr: false
    });
  } catch(error) {
    console.error('Error creating instance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listar instâncias do usuário
app.get("/api/instances", auth, async (req, res) => {
  try {
    const userInstances = await prisma.instance.findMany({
      where: { userId: req.user.id }
    });
    
    // Adiciona status de conexão
    const instancesWithStatus = userInstances.map(inst => {
      const instanceData = instances.get(inst.id);
      const hasConnection = !!instanceData;
      const isConnected = instanceData?.sock?.isConnected || false;
      const hasQr = !!instanceData?.sock?.qrCode;
      
      return {
        id: inst.id,
        name: inst.name,
        userId: inst.userId,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
        connectionStatus: isConnected ? 'connected' : (hasQr ? 'pending_qr' : 'disconnected'),
        hasQr: hasQr,
        inMemory: hasConnection,
        isConnected: isConnected
      };
    });
    
    res.json(instancesWithStatus);
  } catch (error) {
    console.error('Error fetching instances:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obter QR code da instância
app.get("/api/instances/:id/qr", auth, async (req, res) => {
  const instanceId = req.params.id;
  
  console.log(`Fetching QR for instance: ${instanceId}`);
  console.log(`Current instances in memory:`, Array.from(instances.keys()));
  
  const instanceData = instances.get(instanceId);
  
  if (!instanceData) {
    console.log(`Instance ${instanceId} not found in memory`);
    // Tenta buscar do banco de dados primeiro
    const dbInstance = await prisma.instance.findUnique({
      where: { id: instanceId }
    });
    
    if (!dbInstance) {
      return res.status(404).json({ error: "Instance not found" });
    }
    
    if (dbInstance.userId !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    return res.json({
      status: 'disconnected',
      message: 'Instance exists but not connected. Please restart the instance.',
      inMemory: false
    });
  }
  
  if (instanceData.userId !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  
  const sock = instanceData.sock;
  
  // Se a instância já está conectada
  if (sock.isConnected) {
    return res.json({
      status: 'connected',
      message: 'Instance is already connected to WhatsApp',
      isConnected: true
    });
  }
  
  // Se tem QR code disponível
  if (sock.qrCode) {
    try {
      const qrImage = await qrcode.toDataURL(sock.qrCode);
      return res.json({
        qr: sock.qrCode,
        qrImage: qrImage,
        status: 'qr_available',
        message: 'Scan this QR code with WhatsApp',
        isConnected: false,
        hasQr: true
      });
    } catch (error) {
      console.error('Error generating QR image:', error);
      return res.json({
        qr: sock.qrCode,
        status: 'qr_available',
        message: 'Scan this QR code with WhatsApp',
        isConnected: false,
        hasQr: true
      });
    }
  }
  
  // Se não tem QR code ainda
  return res.json({
    status: 'waiting',
    message: 'Waiting for QR code generation... Please try again in a few seconds.',
    timestamp: new Date().toISOString(),
    isConnected: false,
    hasQr: false
  });
});

// Reconectar instância
app.post("/api/instances/:id/reconnect", auth, async (req, res) => {
  try {
    const instanceId = req.params.id;
    
    console.log(`Reconnecting instance: ${instanceId}`);
    
    // Verifica se a instância existe no banco
    const dbInstance = await prisma.instance.findUnique({
      where: { id: instanceId }
    });
    
    if (!dbInstance) {
      return res.status(404).json({ error: "Instance not found" });
    }
    
    if (dbInstance.userId !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Remove instância antiga se existir
    if (instances.has(instanceId)) {
      const oldInstance = instances.get(instanceId);
      if (oldInstance.sock) {
        try {
          oldInstance.sock.ev.removeAllListeners();
          if (oldInstance.sock.ws) {
            oldInstance.sock.ws.close();
          }
        } catch (e) {
          console.error('Error closing old socket:', e);
        }
      }
      instances.delete(instanceId);
      console.log(`Removed old instance ${instanceId} from memory`);
    }
    
    // Cria nova instância
    const sessionPath = `sessions/${instanceId}`;
    const sock = await createWhatsAppSocket(instanceId, sessionPath);
    
    instances.set(instanceId, { 
      sock, 
      userId: req.user.id,
      lastUpdated: new Date(),
      sessionPath: sessionPath
    });
    
    console.log(`Instance ${instanceId} reconnected successfully`);
    
    res.json({
      success: true,
      message: 'Instance reconnected. QR code will be available shortly.',
      instanceId: instanceId
    });
    
  } catch (error) {
    console.error('Error reconnecting instance:', error);
    res.status(500).json({ 
      error: "Failed to reconnect instance",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
    const jid = `${phone}@s.whatsapp.net`;
    console.log(`Sending message to ${jid} via instance ${instanceId}`);
    
    await queue.add(() => 
      instanceData.sock.sendMessage(jid, { text })
    );
    
    res.json({
      ok: true, 
      message: "Message sent successfully",
      to: phone,
      instanceId: instanceId
    });
    
  } catch(error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug: Listar todas as instâncias em memória
app.get("/api/debug/instances", auth, (req, res) => {
  const result = {};
  for (const [id, data] of instances.entries()) {
    result[id] = {
      userId: data.userId,
      hasSocket: !!data.sock,
      hasQR: !!data.sock?.qrCode,
      isConnected: !!data.sock?.isConnected,
      lastUpdated: data.lastUpdated,
      sessionPath: data.sessionPath
    };
  }
  res.json({
    total: instances.size,
    instances: result
  });
});

// Scheduler para mensagens agendadas
setInterval(async ()=>{
  const jobs=await prisma.schedule.findMany({where:{sent:false, sendAt:{lte:new Date()}}});
  for(const j of jobs){
    const instanceData=instances.get(j.instanceId);
    if(!instanceData) continue;
    if(!instanceData.sock.isConnected) continue;
    
    try {
      await instanceData.sock.sendMessage(j.phone+"@s.whatsapp.net",{text:j.text});
      await prisma.schedule.update({where:{id:j.id}, data:{sent:true}});
    } catch(error) {
      console.error(`Error sending scheduled message ${j.id}:`, error);
    }
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

const nextStaticDir = path.join(webDir, '.next/static');

if (existsSync(nextStaticDir)) {
  console.log(`Serving Next.js static files from ${nextStaticDir}`);
  app.use('/_next', express.static(path.join(webDir, '.next')));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp SaaS API running on port ${PORT}`);
  console.log(`Sessions directory: ${sessionsDir}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`JWT Secret: ${process.env.JWT_SECRET ? 'Set' : 'Using default'}`);
});
