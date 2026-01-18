FROM node:20-slim

WORKDIR /app

# 1. Instala git e outras dependências necessárias
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Copia arquivos de configuração primeiro
COPY package.json ./
COPY apps/web/package.json ./apps/web/

# 3. Configura git para evitar prompts
RUN git config --global user.email "docker@example.com" && \
    git config --global user.name "Docker Builder"

# 4. Instala dependências backend (com --no-optional para evitar problemas)
RUN npm install --omit=dev --no-optional

# 5. Instala dependências frontend
RUN cd apps/web && npm install --no-optional

# 6. Copia o resto do código
COPY . .

# 7. Build do frontend
RUN cd apps/web && npm run build

# 8. Gera client do Prisma
RUN npx prisma generate

# 9. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
