FROM node:20-slim

WORKDIR /app

# Instala git (slim já tem, mas garantir)
RUN apt-get update && apt-get install -y git

# Copia arquivos de dependências
COPY package*.json ./
COPY apps/web/package*.json apps/web/

# Instala dependências com --legacy-peer-deps para evitar conflitos
RUN npm install --legacy-peer-deps

# Copia todo o código
COPY . .

# Build do frontend
WORKDIR /app/apps/web
RUN npm install --legacy-peer-deps && npm run build

# Volta para raiz
WORKDIR /app

# Gera Prisma
RUN npx prisma generate

# Cria diretório de sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "start"]
