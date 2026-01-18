FROM node:20-slim

WORKDIR /app

# 1. Copia primeiro apenas os package.json
COPY package.json ./

# 2. Copia package-lock.json se existir, senão ignora
COPY package-lock.json* ./ || true

# 3. Instala dependências globais
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --omit=optional; \
    else \
      npm install --omit=dev --omit=optional; \
    fi

# 4. Copia arquivos do frontend
COPY apps/web/package.json ./apps/web/

# 5. Copia package-lock.json do frontend se existir
COPY apps/web/package-lock.json* ./apps/web/ || true

# 6. Instala dependências do frontend
RUN cd apps/web && \
    if [ -f package-lock.json ]; then \
      npm ci --omit=optional; \
    else \
      npm install --omit=optional; \
    fi

# 7. Copia o resto do código
COPY . .

# 8. Build do frontend
RUN cd apps/web && npm run build

# 9. Gera client do Prisma
RUN npx prisma generate

# 10. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
