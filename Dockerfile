FROM node:20-slim

WORKDIR /app

# 1. Instala git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# 2. Copia TUDO
COPY . .

# 3. Instala dependências backend
RUN npm install --omit=dev --no-optional

# 4. Corrige o script build no frontend (sobrescreve com um correto)
RUN echo '{"scripts": {"build": "next build"}}' > apps/web/package.json.tmp && \
    cat apps/web/package.json | jq '.scripts.build = "next build"' > apps/web/package.json.tmp 2>/dev/null || \
    mv apps/web/package.json.tmp apps/web/package.json

# 5. Instala dependências frontend
RUN cd apps/web && npm install --no-optional

# 6. Build do frontend
RUN cd apps/web && npm run build

# 7. Gera client do Prisma
RUN npx prisma generate

# 8. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
