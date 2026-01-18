'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';

interface Instance {
  id: string;
  name: string;
  status: string;
  connectionStatus?: string;
  hasQr?: boolean;
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
    } catch (error) {
      console.error('Erro ao buscar instâncias:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;

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
        fetchInstances();
        
        // Seleciona a nova instância automaticamente
        const newInstance = {
          id: data.id,
          name: data.name,
          status: data.status
        };
        setSelectedInstance(newInstance);
        await fetchQRCode(data.id);
      }
    } catch (error) {
      console.error('Erro ao criar instância:', error);
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
      
      if (data.qrImage) {
        setQrCodeImage(data.qrImage);
      } else if (data.qr) {
        // Gera QR code a partir do texto
        const qrImage = await QRCode.toDataURL(data.qr);
        setQrCodeImage(qrImage);
      } else if (data.status === 'connected') {
        alert('Instância já está conectada!');
      }
    } catch (error) {
      console.error('Erro ao buscar QR code:', error);
    } finally {
      setQrLoading(false);
    }
  };

  const handleSelectInstance = async (instance: Instance) => {
    setSelectedInstance(instance);
    
    if (instance.hasQr || instance.connectionStatus !== 'connected') {
      await fetchQRCode(instance.id);
    } else {
      setQrCodeImage('');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedInstance || !messageData.phone.trim() || !messageData.text.trim()) {
      alert('Preencha todos os campos');
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
          phone: messageData.phone,
          text: messageData.text
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        alert('Mensagem enviada com sucesso!');
        setMessageData({ phone: '', text: '' });
      } else {
        alert(`Erro: ${data.error || 'Falha ao enviar mensagem'}`);
      }
    } catch (error: any) {
      alert(`Erro: ${error.message}`);
    } finally {
      setSendMessageLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    router.push('/');
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
                <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                  {instances.length} instância(s)
                </span>
              </div>

              <div className="mb-6">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    placeholder="Nome da instância"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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

              <div className="space-y-3">
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
                        <div>
                          <h3 className="font-medium text-gray-900">{instance.name}</h3>
                          <div className="flex items-center mt-1 space-x-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${
                              instance.connectionStatus === 'connected'
                                ? 'bg-green-500'
                                : 'bg-yellow-500'
                            }`}></span>
                            <span className="text-sm text-gray-600">
                              {instance.connectionStatus === 'connected' ? 'Conectado' : 'Desconectado'}
                            </span>
                          </div>
                        </div>
                        {instance.hasQr && instance.connectionStatus !== 'connected' && (
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
              </div>
            </div>
          </div>

          {/* Coluna da direita - QR Code e Envio */}
          <div className="lg:col-span-2 space-y-8">
            {/* QR Code Section */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {selectedInstance ? `QR Code - ${selectedInstance.name}` : 'Selecione uma Instância'}
              </h2>

              {!selectedInstance ? (
                <div className="text-center py-12 text-gray-500">
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
                  <button
                    onClick={() => fetchQRCode(selectedInstance.id)}
                    className="mt-4 px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                  >
                    Atualizar QR Code
                  </button>
                </div>
              ) : selectedInstance.connectionStatus === 'connected' ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-green-600 text-2xl">✓</span>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Conectado!</h3>
                  <p className="text-gray-600">
                    Esta instância está conectada ao WhatsApp e pronta para uso.
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-yellow-600 text-2xl">!</span>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Aguardando QR Code</h3>
                  <p className="text-gray-600 mb-4">
                    Clique no botão abaixo para gerar o QR code.
                  </p>
                  <button
                    onClick={() => fetchQRCode(selectedInstance.id)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Gerar QR Code
                  </button>
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
              ) : selectedInstance.connectionStatus !== 'connected' ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-yellow-600 text-xl">⚠️</span>
                  </div>
                  <p className="text-gray-700">
                    Esta instância não está conectada ao WhatsApp.
                  </p>
                  <p className="text-gray-600 text-sm mt-2">
                    Conecte-a usando o QR code acima para começar a enviar mensagens.
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
