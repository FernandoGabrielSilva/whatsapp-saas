/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // Isso gera arquivos estáticos
  distDir: '.next',
  trailingSlash: false,
  images: {
    unoptimized: true, // Necessário para export estático
  },
}

module.exports = nextConfig
