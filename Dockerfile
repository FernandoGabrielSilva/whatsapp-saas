FROM node:20-slim

WORKDIR /app

# 1. Copia arquivos de configuração primeiro
COPY package.json ./
COPY apps/web/package.json ./apps/web/

# 2. Instala dependências backend
RUN npm install --omit=dev --omit=optional

# 3. Instala dependências frontend
RUN cd apps/web && npm install --omit=optional

# 4. Copia o resto do código
COPY . .

# 5. Build do frontend
RUN cd apps/web && npm run build

# 6. Gera client do Prisma
RUN npx prisma generate

# 7. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
