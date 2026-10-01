FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm run db:build && npm prune --omit=dev
COPY scripts/container-init.cjs scripts/retention.cjs ./scripts/
USER node
CMD ["node", "dist/server.js"]
