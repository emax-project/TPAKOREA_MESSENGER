# 서버 + 웹 클라이언트 배포용 (runner에 Node 불필요, Docker만 있으면 됨)
# Stage 1: 웹 클라이언트 빌드
FROM node:20-bookworm-slim AS client-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client packages/client
COPY packages/server/package.json packages/server/package.json
# postinstall은 server의 prisma generate인데 client-builder에는 prisma 없음 → 스크립트 생략
RUN npm ci --ignore-scripts
ENV VITE_API_URL=
ENV VITE_BASE_URL=/
RUN npm run build --workspace=client

# Stage 2: API 서버 + 클라이언트 정적 파일
FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CLIENT_DIST=/app/client-dist
COPY packages/server/package.json ./
RUN npm install --omit=dev
COPY packages/server/prisma ./prisma
RUN npx prisma generate
COPY packages/server/src ./src
COPY packages/server/scripts ./scripts
COPY --from=client-builder /app/packages/client/dist ./client-dist
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db execute --schema prisma/schema.prisma --file prisma/pre-push.sql && npx prisma db push && node src/index.js"]
