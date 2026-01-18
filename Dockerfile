FROM node:20-slim

WORKDIR /app

# 1. Instala dependências globais (SEM git)
COPY package.json package-lock.json ./
RUN npm install --omit=dev --omit=optional

# 2. Instala dependências do frontend (SEM git)
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm install --omit=optional

# 3. Copia o resto do código
COPY . .

# 4. Build do frontend
RUN cd apps/web && npm run build

# 5. Gera client do Prisma
RUN npx prisma generate

# 6. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
