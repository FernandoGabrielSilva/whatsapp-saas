FROM node:20-slim

WORKDIR /app

# 1. Instala git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# 2. Configura git
RUN git config --global user.email "docker@example.com" && \
    git config --global user.name "Docker Builder"

# 3. Copia tudo de uma vez
COPY . .

# 4. Instala dependências backend
RUN npm install --omit=dev --no-optional

# 5. Instala dependências frontend
RUN cd apps/web && npm install --no-optional

# 6. Build do frontend USANDO next build diretamente
RUN cd apps/web && npx next build

# 7. Gera client do Prisma
RUN npx prisma generate

# 8. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
