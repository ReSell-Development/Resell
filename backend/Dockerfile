FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./

RUN npm ci --only=production

COPY . .

EXPOSE 5000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]