/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // ✅ MUDE ISSO
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  trailingSlash: false,
}

module.exports = nextConfig
