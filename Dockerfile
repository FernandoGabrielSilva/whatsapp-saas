[file name]: Dockerfile
[file content begin]
FROM node:20-alpine

WORKDIR /app

# 1. Instala dependências globais
COPY package.json ./
RUN npm install

# 2. Instala e build do frontend
COPY apps/web/package.json apps/web/
RUN cd apps/web && npm install && npm run build

# 3. Copia o resto do código
COPY . .

# 4. Gera client do Prisma
RUN npx prisma generate

# 5. Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
[file content end]
