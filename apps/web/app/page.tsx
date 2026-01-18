'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function HomePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    // Verificar se o usuário está logado
    const token = localStorage.getItem('token');
    const email = localStorage.getItem('userEmail');
    
    if (token) {
      setIsLoggedIn(true);
      setUserEmail(email || '');
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    setIsLoggedIn(false);
    setUserEmail('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <nav className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold">W</span>
            </div>
            <h1 className="text-xl font-bold text-gray-800">WhatsApp SaaS</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {isLoggedIn ? (
              <>
                <span className="text-gray-600">Olá, {userEmail}</span>
                <Link 
                  href="/dashboard"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Dashboard
                </Link>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                >
                  Sair
                </button>
              </>
            ) : (
              <>
                <Link 
                  href="/login"
                  className="px-4 py-2 text-blue-600 hover:text-blue-800 transition"
                >
                  Login
                </Link>
                <Link 
                  href="/register"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Cadastrar
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-12">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Envie mensagens pelo WhatsApp
            <span className="block text-blue-600 mt-2">via API</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-10">
            Conecte sua conta do WhatsApp e envie mensagens programaticamente. 
            Ideal para automação, marketing e comunicação em escala.
          </p>

          <div className="flex justify-center space-x-4 mb-16">
            {isLoggedIn ? (
              <Link 
                href="/dashboard"
                className="px-8 py-3 bg-green-600 text-white text-lg font-semibold rounded-lg hover:bg-green-700 transition shadow-lg"
              >
                Ir para Dashboard
              </Link>
            ) : (
              <>
                <Link 
                  href="/register"
                  className="px-8 py-3 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition shadow-lg"
                >
                  Começar Agora
                </Link>
                <Link 
                  href="/login"
                  className="px-8 py-3 border-2 border-blue-600 text-blue-600 text-lg font-semibold rounded-lg hover:bg-blue-50 transition"
                >
                  Fazer Login
                </Link>
              </>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-blue-600 text-2xl">📱</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Conexão Simples</h3>
              <p className="text-gray-600">
                Conecte sua conta do WhatsApp escaneando um QR code. 
                Sua sessão fica segura em nossos servidores.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-green-600 text-2xl">⚡</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">API Poderosa</h3>
              <p className="text-gray-600">
                Envie mensagens via API REST. Suporte para texto, 
                agendamento e múltiplos números simultaneamente.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <span className="text-purple-600 text-2xl">🔒</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Segurança Total</h3>
              <p className="text-gray-600">
                Autenticação JWT, criptografia de ponta a ponta e 
                armazenamento seguro das credenciais.
              </p>
            </div>
          </div>

          {!isLoggedIn && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Pronto para começar?</h2>
              <p className="text-gray-700 mb-6">
                Cadastre-se gratuitamente e comece a enviar mensagens em minutos.
              </p>
              <Link 
                href="/register"
                className="inline-block px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
              >
                Criar Conta Gratuita
              </Link>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-gray-600">
            <p>© {new Date().getFullYear()} WhatsApp SaaS. Todos os direitos reservados.</p>
            <p className="mt-2 text-sm">Conectando o mundo via WhatsApp</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
