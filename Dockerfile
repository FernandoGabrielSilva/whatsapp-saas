FROM node:20-slim

WORKDIR /app

# 1. Instala git e outras dependências necessárias
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Configura git para evitar prompts
RUN git config --global user.email "docker@example.com" && \
    git config --global user.name "Docker Builder"

# 3. Copia package.json da raiz
COPY package.json ./

# 4. Instala dependências backend
RUN npm install --omit=dev --no-optional

# 5. Copia arquivos do frontend
COPY apps/web ./apps/web

# 6. Instala e build do frontend
RUN cd apps/web && \
    npm install --no-optional && \
    npm run build

# 7. Copia o resto do código (exceto o que já copiamos)
COPY prisma ./prisma
COPY apps/api ./apps/api

# 8. Gera client do Prisma
RUN npx prisma generate

# 9. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
