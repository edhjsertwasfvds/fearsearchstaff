# Dockerfile для Railway: билдится из корня репозитория, путь /backend/Dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
