FROM node:20-alpine

WORKDIR /app

# Copia apenas os arquivos necessários primeiro (cache otimizado)
COPY package.json ./
COPY apps/web/package.json apps/web/package.json

# Instala dependências globais
RUN npm ci --only=production

# Instala dependências de desenvolvimento globalmente
RUN npm install -D prisma

# Instala dependências do frontend
RUN cd apps/web && npm ci

# Copia o resto do projeto
COPY . .

# Build do frontend
RUN npm run web:build

# Gera client do Prisma
RUN npx prisma generate

# Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
