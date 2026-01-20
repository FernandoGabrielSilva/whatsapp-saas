'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';

interface Instance {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  connectionStatus: string;
  hasQr: boolean;
  inMemory: boolean;
  isConnected: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [qrCodeImage, setQrCodeImage] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [sendMessageLoading, setSendMessageLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [messageData, setMessageData] = useState({
    phone: '',
    text: ''
  });

  useEffect(() => {
    // Verificar se está logado
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetchInstances();
  }, [router]);

  const fetchInstances = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/instances', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
        return;
      }

      const data = await response.json();
      setInstances(data);
      
      // Se há uma instância selecionada, atualiza seus dados
      if (selectedInstance) {
        const updatedInstance = data.find((inst: Instance) => inst.id === selectedInstance.id);
        if (updatedInstance) {
          setSelectedInstance(updatedInstance);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar instâncias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) {
      alert('Digite um nome para a instância');
      return;
    }

    setCreatingInstance(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newInstanceName })
      });

      const data = await response.json();
      
      if (response.ok) {
        setNewInstanceName('');
        await fetchInstances();
        
        // Seleciona a nova instância automaticamente
        const newInstance = {
          id: data.id,
          name: data.name,
          userId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          connectionStatus: 'disconnected',
          hasQr: data.hasQr || false,
          inMemory: true,
          isConnected: false
        };
        setSelectedInstance(newInstance);
        
        // Aguarda um pouco e tenta buscar o QR code
        setTimeout(() => {
          fetchQRCode(data.id);
        }, 1000);
      } else {
        alert(`Erro: ${data.error || 'Falha ao criar instância'}`);
      }
    } catch (error: any) {
      console.error('Erro ao criar instância:', error);
      alert(`Erro: ${error.message}`);
    } finally {
      setCreatingInstance(false);
    }
  };

  const fetchQRCode = async (instanceId: string) => {
    setQrLoading(true);
    setQrCodeImage('');
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/instances/${instanceId}/qr`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 404) {
          // Instância não encontrada na memória
          const reconnect = confirm('Instância não está ativa. Deseja reconectar?');
          if (reconnect) {
            await reconnectInstance(instanceId);
          }
          return;
        }
        throw new Error(data.error || 'Erro ao buscar QR code');
      }
      
      if (data.qrImage) {
        setQrCodeImage(data.qrImage);
      } else if (data.qr) {
        // Gera QR code a partir do texto
        const qrImage = await QRCode.toDataURL(data.qr);
        setQrCodeImage(qrImage);
      } else if (data.status === 'connected') {
        setQrCodeImage('');
        alert('Instância já está conectada ao WhatsApp!');
        await fetchInstances(); // Atualiza status
      } else if (data.status === 'waiting') {
        // QR ainda não gerado, tenta novamente após 2 segundos
        setTimeout(() => {
          fetchQRCode(instanceId);
        }, 2000);
      } else if (data.status === 'disconnected') {
        alert('Instância desconectada. Tente reconectar.');
      }
    } catch (error: any) {
      console.error('Erro ao buscar QR code:', error);
      alert(`Erro: ${error.message}`);
    } finally {
      setQrLoading(false);
    }
  };

  const reconnectInstance = async (instanceId: string) => {
    setReconnecting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/instances/${instanceId}/reconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Falha ao reconectar instância');
      }
      
      alert('Instância sendo reconectada... Aguarde alguns segundos.');
      
      // Atualiza a lista de instâncias
      await fetchInstances();
      
      // Aguarda e tenta buscar o QR code
      setTimeout(() => {
        fetchQRCode(instanceId);
      }, 2000);
      
    } catch (error: any) {
      console.error('Erro ao reconectar:', error);
      alert(`Erro: ${error.message}`);
    } finally {
      setReconnecting(false);
    }
  };

  const handleSelectInstance = async (instance: Instance) => {
    setSelectedInstance(instance);
    setQrCodeImage('');
    
    // Se a instância não está conectada e está em memória, busca QR code
    if (!instance.isConnected && instance.inMemory) {
      await fetchQRCode(instance.id);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedInstance) {
      alert('Selecione uma instância primeiro');
      return;
    }

    if (!messageData.phone.trim() || !messageData.text.trim()) {
      alert('Preencha todos os campos');
      return;
    }

    // Validação do número de telefone
    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(messageData.phone.replace(/\D/g, ''))) {
      alert('Número de telefone inválido. Use apenas dígitos (10-15 caracteres)');
      return;
    }

    setSendMessageLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instanceId: selectedInstance.id,
          phone: messageData.phone.replace(/\D/g, ''),
          text: messageData.text
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        alert('✅ Mensagem enviada com sucesso!');
        setMessageData({ phone: '', text: '' });
      } else {
        alert(`❌ Erro: ${data.error || 'Falha ao enviar mensagem'}`);
      }
    } catch (error: any) {
      alert(`❌ Erro: ${error.message}`);
    } finally {
      setSendMessageLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    router.push('/');
  };

  const refreshInstances = async () => {
    setLoading(true);
    await fetchInstances();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold">W</span>
            </div>
            <h1 className="text-xl font-bold text-gray-800">WhatsApp SaaS Dashboard</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <Link 
              href="/"
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition"
            >
              Home
            </Link>
            <button
              onClick={refreshInstances}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              Atualizar
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Sair
            </button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Coluna da esquerda - Instâncias */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Suas Instâncias</h2>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                    {instances.length} instância(s)
                  </span>
                  <button
                    onClick={refreshInstances}
                    className="text-sm text-blue-600 hover:text-blue-800"
                    title="Atualizar lista"
                  >
                    🔄
                  </button>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    placeholder="Nome da instância"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    onKeyPress={(e) => e.key === 'Enter' && handleCreateInstance()}
                  />
                  <button
                    onClick={handleCreateInstance}
                    disabled={creatingInstance || !newInstanceName.trim()}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      creatingInstance || !newInstanceName.trim()
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {creatingInstance ? 'Criando...' : 'Nova'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Cada instância representa uma conexão com o WhatsApp
                </p>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {instances.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>Nenhuma instância criada ainda</p>
                    <p className="text-sm mt-2">Crie sua primeira instância para começar</p>
                  </div>
                ) : (
                  instances.map((instance) => (
                    <div
                      key={instance.id}
                      onClick={() => handleSelectInstance(instance)}
                      className={`p-4 rounded-lg border cursor-pointer transition ${
                        selectedInstance?.id === instance.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{instance.name}</h3>
                          <div className="flex items-center mt-1 space-x-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${
                              instance.isConnected
                                ? 'bg-green-500'
                                : instance.hasQr
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}></span>
                            <span className="text-sm text-gray-600">
                              {instance.isConnected 
                                ? 'Conectado' 
                                : instance.hasQr 
                                ? 'QR Disponível' 
                                : 'Desconectado'}
                            </span>
                            {!instance.inMemory && (
                              <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                                Offline
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            ID: {instance.id.substring(0, 8)}...
                          </p>
                        </div>
                        {instance.hasQr && !instance.isConnected && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                            QR Pendente
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Como conectar:</h3>
                <ol className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start">
                    <span className="bg-blue-100 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs mr-2">1</span>
                    Crie uma instância
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-100 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs mr-2">2</span>
                    Clique na instância para ver o QR code
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-100 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs mr-2">3</span>
                    Escaneie com WhatsApp no celular
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-100 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs mr-2">4</span>
                    Comece a enviar mensagens
                  </li>
                </ol>
                <div className="mt-4 text-xs text-gray-500">
                  <p>⚠️ As instâncias ficam apenas em memória. Reiniciar o servidor desconecta todas.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Coluna da direita - QR Code e Envio */}
          <div className="lg:col-span-2 space-y-8">
            {/* QR Code Section */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {selectedInstance ? `QR Code - ${selectedInstance.name}` : 'Selecione uma Instância'}
                </h2>
                {selectedInstance && (
                  <div className="flex items-center space-x-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      selectedInstance.isConnected
                        ? 'bg-green-500'
                        : selectedInstance.hasQr
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}></span>
                    <span className="text-sm text-gray-600">
                      {selectedInstance.isConnected 
                        ? 'Conectado' 
                        : selectedInstance.hasQr 
                        ? 'QR Disponível' 
                        : 'Desconectado'}
                    </span>
                  </div>
                )}
              </div>

              {!selectedInstance ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-gray-400 text-2xl">📱</span>
                  </div>
                  <p>Selecione uma instância à esquerda para ver o QR code</p>
                </div>
              ) : qrLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Carregando QR code...</p>
                </div>
              ) : qrCodeImage ? (
                <div className="text-center">
                  <div className="inline-block p-4 bg-white border border-gray-200 rounded-lg">
                    <img 
                      src={qrCodeImage} 
                      alt="QR Code" 
                      className="w-64 h-64 mx-auto"
                    />
                  </div>
                  <p className="mt-4 text-sm text-gray-600">
                    Escaneie este QR code com o WhatsApp no seu celular
                  </p>
                  <div className="mt-4 space-x-2">
                    <button
                      onClick={() => fetchQRCode(selectedInstance.id)}
                      className="px-4 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition"
                    >
                      Atualizar QR Code
                    </button>
                    <button
                      onClick={() => reconnectInstance(selectedInstance.id)}
                      disabled={reconnecting}
                      className={`px-4 py-2 text-sm rounded-lg transition ${
                        reconnecting
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      }`}
                    >
                      {reconnecting ? 'Reconectando...' : 'Reconectar Instância'}
                    </button>
                  </div>
                  <p className="mt-4 text-xs text-gray-500">
                    O QR code expira após alguns minutos. Se expirar, clique em "Atualizar QR Code"
                  </p>
                </div>
              ) : selectedInstance.isConnected ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-green-600 text-2xl">✓</span>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Conectado!</h3>
                  <p className="text-gray-600 mb-4">
                    Esta instância está conectada ao WhatsApp e pronta para uso.
                  </p>
                  <div className="space-x-2">
                    <button
                      onClick={() => fetchQRCode(selectedInstance.id)}
                      className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      Verificar Status
                    </button>
                    <button
                      onClick={() => reconnectInstance(selectedInstance.id)}
                      className="px-4 py-2 text-sm bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition"
                    >
                      Reconectar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-gray-400 text-2xl">⏳</span>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Aguardando QR Code</h3>
                  <p className="text-gray-600 mb-4">
                    {selectedInstance.inMemory
                      ? 'O QR code será gerado automaticamente. Clique no botão abaixo para verificar.'
                      : 'Esta instância não está ativa na memória. Reconecte para gerar um novo QR code.'}
                  </p>
                  <div className="space-x-2">
                    <button
                      onClick={() => fetchQRCode(selectedInstance.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      Verificar QR Code
                    </button>
                    <button
                      onClick={() => reconnectInstance(selectedInstance.id)}
                      disabled={reconnecting}
                      className={`px-4 py-2 rounded-lg transition ${
                        reconnecting
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-yellow-600 text-white hover:bg-yellow-700'
                      }`}
                    >
                      {reconnecting ? 'Reconectando...' : 'Reconectar'}
                    </button>
                  </div>
                  {!selectedInstance.inMemory && (
                    <p className="mt-4 text-xs text-red-600">
                      ⚠️ Esta instância não está ativa na memória do servidor. 
                      Isso pode acontecer após reiniciar o servidor.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Send Message Section */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Enviar Mensagem</h2>

              {!selectedInstance ? (
                <div className="text-center py-8 text-gray-500">
                  <p>Selecione uma instância conectada para enviar mensagens</p>
                </div>
              ) : !selectedInstance.isConnected ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-yellow-600 text-xl">⚠️</span>
                  </div>
                  <p className="text-gray-700">
                    Esta instância não está conectada ao WhatsApp.
                  </p>
                  <p className="text-gray-600 text-sm mt-2">
                    {selectedInstance.hasQr 
                      ? 'Escaneie o QR code acima para conectar.'
                      : 'Reconecte a instância para gerar um QR code.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Número do WhatsApp
                    </label>
                    <input
                      type="text"
                      value={messageData.phone}
                      onChange={(e) => setMessageData({...messageData, phone: e.target.value})}
                      placeholder="5511999999999 (com DDI e DDD, sem +)"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Formato: DDI + DDD + Número (ex: 5511999999999 para Brasil)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Mensagem
                    </label>
                    <textarea
                      value={messageData.text}
                      onChange={(e) => setMessageData({...messageData, text: e.target.value})}
                      placeholder="Digite sua mensagem aqui..."
                      rows={4}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
                    />
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="text-sm text-gray-600">
                      Instância: <span className="font-medium">{selectedInstance.name}</span>
                      {selectedInstance.isConnected && (
                        <span className="ml-2 text-green-600">● Conectado</span>
                      )}
                    </div>
                    <button
                      onClick={handleSendMessage}
                      disabled={sendMessageLoading || !messageData.phone.trim() || !messageData.text.trim()}
                      className={`px-6 py-3 rounded-lg font-medium transition ${
                        sendMessageLoading || !messageData.phone.trim() || !messageData.text.trim()
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {sendMessageLoading ? 'Enviando...' : 'Enviar Mensagem'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* API Usage Section */}
            <div className="bg-gray-900 rounded-xl shadow-sm p-6 text-white">
              <h2 className="text-xl font-semibold mb-4">Uso da API</h2>
              <p className="text-gray-300 mb-4">
                Use nossa API para integrar com seus sistemas:
              </p>
              
              <div className="bg-gray-800 rounded-lg p-4 mb-4 overflow-x-auto">
                <pre className="text-sm">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/send \\
  -H "Authorization: Bearer SEU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "instanceId": "${selectedInstance?.id || 'INSTANCE_ID'}",
    "phone": "5511999999999",
    "text": "Sua mensagem aqui"
  }'`}
                </pre>
              </div>

              <div className="flex items-center text-sm text-gray-400">
                <span className="mr-2">📚</span>
                <span>Documentação completa disponível em /api</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
