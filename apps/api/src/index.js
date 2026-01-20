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

// Debug específico para Render
app.get("/api/render-debug", (req, res) => {
  const checkPaths = [
    { name: 'Current Directory', path: process.cwd() },
    { name: 'Web Directory', path: path.join(__dirname, '../../web') },
    { name: 'Next Build', path: path.join(__dirname, '../../web/.next') },
    { name: 'Next Static', path: path.join(__dirname, '../../web/.next/static') },
    { name: 'Next Export', path: path.join(__dirname, '../../web/out') },
    { name: 'Public', path: path.join(__dirname, '../../web/public') },
    { name: 'Sessions', path: sessionsDir },
    { name: 'App Root', path: path.join(__dirname, '../../..') }
  ];
  
  const results = [];
  
  checkPaths.forEach(item => {
    const exists = existsSync(item.path);
    let files = [];
    let error = null;
    
    if (exists) {
      try {
        files = readdirSync(item.path).slice(0, 10);
      } catch (e) {
        error = e.message;
      }
    }
    
    results.push({
      name: item.name,
      path: item.path,
      exists: exists,
      files: files,
      error: error
    });
  });
  
  res.json({
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT,
    cwd: process.cwd(),
    __dirname: __dirname,
    __filename: __filename,
    paths: results,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  });
});

// ============ CONFIGURAÇÃO DO FRONTEND ============

// Caminhos importantes
const webDir = path.join(__dirname, '../../web');
const nextBuildDir = path.join(webDir, '.next');
const exportDir = path.join(webDir, 'out'); // Next.js export estático
const publicDir = path.join(webDir, 'public');

console.log('=========================================');
console.log('🚀 Configurando WhatsApp SaaS');
console.log(`📁 Web Directory: ${webDir}`);
console.log(`📁 Next Build: ${nextBuildDir}`);
console.log(`📁 Export Static: ${exportDir}`);
console.log(`📁 Public: ${publicDir}`);
console.log('=========================================');

// Cria pasta public se não existir
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
  console.log(`📁 Criada pasta public: ${publicDir}`);
}

// Serve arquivos públicos
console.log(`📁 Servindo arquivos públicos de: ${publicDir}`);
app.use(express.static(publicDir));
app.use('/public', express.static(publicDir));

// ============ SERVE NEXT.JS EXPORT STATIC (SOLUÇÃO DEFINITIVA) ============

if (existsSync(exportDir)) {
  console.log(`✅ Export estático do Next.js encontrado em: ${exportDir}`);
  
  // Serve todos os arquivos da pasta out
  app.use(express.static(exportDir));
  
  // Serve arquivos CSS, JS, imagens, etc.
  console.log('✅ Frontend estático configurado com sucesso!');
  
  // Log dos arquivos encontrados
  try {
    const exportFiles = readdirSync(exportDir);
    console.log(`📦 Arquivos no export: ${exportFiles.slice(0, 10).join(', ')}${exportFiles.length > 10 ? '...' : ''}`);
    
    // Verifica se tem index.html
    const indexPath = path.join(exportDir, 'index.html');
    if (existsSync(indexPath)) {
      console.log(`✅ index.html encontrado: ${indexPath}`);
    } else {
      console.log(`❌ index.html NÃO encontrado em: ${indexPath}`);
    }
    
    // Verifica arquivos CSS
    const cssFiles = exportFiles.filter(f => f.endsWith('.css'));
    console.log(`🎨 Arquivos CSS: ${cssFiles.length}`);
    
    // Verifica arquivos JS
    const jsFiles = exportFiles.filter(f => f.endsWith('.js'));
    console.log(`⚡ Arquivos JS: ${jsFiles.length}`);
  } catch (e) {
    console.log(`❌ Erro ao listar export: ${e.message}`);
  }
  
} else if (existsSync(nextBuildDir)) {
  console.log(`⚠️  Export estático não encontrado, usando build normal`);
  
  // Serve arquivos estáticos do Next.js build
  const staticDir = path.join(nextBuildDir, 'static');
  if (existsSync(staticDir)) {
    console.log(`📁 Servindo /_next/static de: ${staticDir}`);
    app.use('/_next/static', express.static(staticDir));
    
    // Verifica se tem CSS
    try {
      const findCssFiles = (dir) => {
        const cssFiles = [];
        const search = (currentDir) => {
          try {
            const items = readdirSync(currentDir);
            for (const item of items) {
              const fullPath = path.join(currentDir, item);
              const stat = statSync(fullPath);
              if (stat.isDirectory()) {
                search(fullPath);
              } else if (item.endsWith('.css')) {
                cssFiles.push(path.relative(staticDir, fullPath));
              }
            }
          } catch (e) {
            // Ignora
          }
        };
        search(dir);
        return cssFiles;
      };
      
      const cssFiles = findCssFiles(staticDir);
      console.log(`🎨 Arquivos CSS no build: ${cssFiles.length}`);
    } catch (e) {
      console.log(`❌ Erro ao buscar CSS: ${e.message}`);
    }
  }
} else {
  console.log(`❌ Nenhum build do Next.js encontrado!`);
  console.log(`   Execute: cd apps/web && npm run build`);
}

// ============ ROTA PARA FRONTEND ============

app.get("*", (req, res, next) => {
  // Se for API, passa adiante
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  console.log(`🖥️  Frontend request: ${req.path}`);
  
  // Se tivermos export estático, servimos dele
  if (existsSync(exportDir)) {
    let filePath = req.path;
    
    // Remove trailing slash
    if (filePath.endsWith('/') && filePath.length > 1) {
      filePath = filePath.slice(0, -1);
    }
    
    // Constrói o caminho do arquivo
    let fullPath;
    
    if (filePath === '') {
      // Raiz
      fullPath = path.join(exportDir, 'index.html');
    } else if (!path.extname(filePath)) {
      // Se não tem extensão, pode ser uma página
      // Tenta .html primeiro
      fullPath = path.join(exportDir, filePath + '.html');
      
      // Se não existe, tenta como diretório com index.html
      if (!existsSync(fullPath)) {
        const dirPath = path.join(exportDir, filePath);
        const indexPath = path.join(dirPath, 'index.html');
        if (existsSync(indexPath)) {
          fullPath = indexPath;
        }
      }
    } else {
      // Tem extensão, serve o arquivo diretamente
      fullPath = path.join(exportDir, filePath);
    }
    
    // Tenta servir o arquivo
    if (existsSync(fullPath)) {
      console.log(`✅ Servindo: ${path.relative(exportDir, fullPath)}`);
      
      // Headers para cache
      if (fullPath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0');
      } else if (fullPath.endsWith('.css') || fullPath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      
      return res.sendFile(fullPath);
    }
    
    // Se não encontrou o arquivo, tenta index.html como fallback
    const indexPath = path.join(exportDir, 'index.html');
    if (existsSync(indexPath)) {
      console.log(`↪️  Fallback para index.html`);
      return res.sendFile(indexPath);
    }
  }
  
  // Se chegou aqui, não temos export estático ou não encontramos o arquivo
  // Tenta servir do build normal do Next.js
  if (existsSync(nextBuildDir)) {
    console.log(`⚠️  Tentando servir do build normal`);
    
    // Tenta servir index.html da raiz do web
    const webIndexPath = path.join(webDir, 'index.html');
    if (existsSync(webIndexPath)) {
      console.log(`✅ Servindo index.html do web dir`);
      return res.sendFile(webIndexPath);
    }
  }
  
  // Fallback: dashboard informativo
  console.log(`❌ Nenhum arquivo frontend encontrado, servindo dashboard`);
  serveNoBuildDashboard(res);
});

// Dashboard quando não há build
function serveNoBuildDashboard(res) {
  const hasExport = existsSync(exportDir);
  const hasBuild = existsSync(nextBuildDir);
  
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp SaaS - Configuração</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            color: white;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 1.5rem;
            padding: 3rem;
            max-width: 900px;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        
        h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            text-align: center;
        }
        
        .subtitle {
            text-align: center;
            opacity: 0.9;
            margin-bottom: 2rem;
            font-size: 1.1rem;
        }
        
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        
        .status-card {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 1rem;
            padding: 1.5rem;
            text-align: center;
        }
        
        .status-title {
            font-size: 1.1rem;
            margin-bottom: 0.5rem;
            opacity: 0.9;
        }
        
        .status-value {
            font-size: 1.5rem;
            font-weight: bold;
        }
        
        .good {
            color: #4ade80;
        }
        
        .bad {
            color: #f87171;
        }
        
        .warning {
            color: #fbbf24;
        }
        
        .instructions {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 1rem;
            padding: 1.5rem;
            margin: 2rem 0;
        }
        
        .instructions h3 {
            margin-bottom: 1rem;
            color: #93c5fd;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        code {
            background: rgba(0, 0, 0, 0.3);
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-family: 'Courier New', monospace;
            display: block;
            margin: 0.5rem 0;
            overflow-x: auto;
        }
        
        .endpoints {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        
        .endpoint-card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 0.75rem;
            padding: 1rem;
            transition: transform 0.3s;
        }
        
        .endpoint-card:hover {
            transform: translateY(-4px);
            background: rgba(255, 255, 255, 0.15);
        }
        
        .method {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 0.375rem;
            font-size: 0.75rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .get { background: #10b981; }
        .post { background: #3b82f6; }
        
        .path {
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            word-break: break-all;
        }
        
        a {
            color: #93c5fd;
            text-decoration: none;
        }
        
        a:hover {
            color: #bfdbfe;
            text-decoration: underline;
        }
        
        .actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
            margin-top: 2rem;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn:hover {
            background: #2563eb;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 WhatsApp SaaS</h1>
        <p class="subtitle">Backend funcionando! Configurando frontend...</p>
        
        <div class="status-grid">
            <div class="status-card">
                <div class="status-title">Backend API</div>
                <div class="status-value good">✅ Online</div>
            </div>
            
            <div class="status-card">
                <div class="status-title">Next.js Export</div>
                <div class="status-value ${hasExport ? 'good' : 'bad'}">
                    ${hasExport ? '✅ Encontrado' : '❌ Não encontrado'}
                </div>
            </div>
            
            <div class="status-card">
                <div class="status-title">Next.js Build</div>
                <div class="status-value ${hasBuild ? 'warning' : 'bad'}">
                    ${hasBuild ? '⚠️  Encontrado' : '❌ Não encontrado'}
                </div>
            </div>
            
            <div class="status-card">
                <div class="status-title">Status CSS</div>
                <div class="status-value ${hasExport || hasBuild ? 'warning' : 'bad'}">
                    ${hasExport || hasBuild ? '🔄 Carregando' : '❌ Indisponível'}
                </div>
            </div>
        </div>
        
        <div class="instructions">
            <h3>📋 Para configurar o frontend:</h3>
            
            ${!hasExport ? `
            <p><strong>1. Configure o Next.js para export estático:</strong></p>
            <code>// Em apps/web/next.config.js
module.exports = {
  output: 'export', // Adicione esta linha
  reactStrictMode: true,
  images: { unoptimized: true }
}</code>
            
            <p><strong>2. Rebuild o Next.js:</strong></p>
            <code>cd apps/web && npm run build</code>
            
            <p><strong>3. Verifique se a pasta 'out' foi criada:</strong></p>
            <code>ls apps/web/out/</code>
            ` : `
            <p><strong>✅ Frontend estático configurado!</strong></p>
            <p>O Next.js export está funcionando corretamente.</p>
            `}
            
            ${hasBuild && !hasExport ? `
            <p><strong>⚠️  AVISO: Build normal encontrado, mas export não.</strong></p>
            <p>Recomendamos usar 'output: export' para melhor compatibilidade.</p>
            ` : ''}
        </div>
        
        <div class="endpoints">
            <div class="endpoint-card">
                <span class="method get">GET</span>
                <div class="path"><a href="/api/health" target="_blank">/api/health</a></div>
                <p style="opacity: 0.9; margin-top: 0.5rem; font-size: 0.9rem;">Verificar saúde</p>
            </div>
            
            <div class="endpoint-card">
                <span class="method get">GET</span>
                <div class="path"><a href="/api/status" target="_blank">/api/status</a></div>
                <p style="opacity: 0.9; margin-top: 0.5rem; font-size: 0.9rem;">Status completo</p>
            </div>
            
            <div class="endpoint-card">
                <span class="method get">GET</span>
                <div class="path"><a href="/api" target="_blank">/api</a></div>
                <p style="opacity: 0.9; margin-top: 0.5rem; font-size: 0.9rem;">Documentação</p>
            </div>
            
            <div class="endpoint-card">
                <span class="method get">GET</span>
                <div class="path"><a href="/api/render-debug" target="_blank">/api/render-debug</a></div>
                <p style="opacity: 0.9; margin-top: 0.5rem; font-size: 0.9rem;">Debug do sistema</p>
            </div>
        </div>
        
        <div class="actions">
            <a href="/api" class="btn">📚 Ver Documentação</a>
            <button onclick="window.location.reload()" class="btn">🔄 Recarregar</button>
            <a href="/api/render-debug" target="_blank" class="btn btn-secondary">🐛 Debug</a>
        </div>
    </div>
</body>
</html>`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 WhatsApp SaaS API iniciada na porta ${PORT}`);
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Sessions: ${sessionsDir}`);
  console.log(`🖥️  Frontend Export: ${existsSync(exportDir) ? '✅ Encontrado' : '❌ Não encontrado'}`);
  console.log(`🖥️  Frontend Build: ${existsSync(nextBuildDir) ? '✅ Encontrado' : '❌ Não encontrado'}`);
  console.log('=========================================');
  console.log(`👉 Acesse: http://localhost:${PORT}`);
  console.log(`👉 API: http://localhost:${PORT}/api`);
  console.log(`👉 Debug: http://localhost:${PORT}/api/render-debug`);
  console.log('=========================================');
});
