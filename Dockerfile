FROM node:20

WORKDIR /app

# Copia manifests
COPY package.json ./
COPY apps/web/package.json apps/web/package.json

# Instala deps da raiz
RUN npm install

# Copia o resto do projeto
COPY . .

# Build do frontend
RUN npm run build

# Cria diretório para sessions
RUN mkdir -p sessions

EXPOSE 3000

CMD ["npm", "run", "start"]
