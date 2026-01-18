/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  distDir: '.next',
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
