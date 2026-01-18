FROM node:20

WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm install

# Copy all
COPY . .

# Build web
RUN npm run web:build

# Prisma
RUN npx prisma generate

EXPOSE 3000

CMD ["npm","run","start"]
