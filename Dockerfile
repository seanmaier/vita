# Build stage: frontend bundle + type check of the server
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# Runtime stage: Node runs the server's TypeScript directly (type stripping)
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/app.db \
    BACKUP_DIR=/backups \
    STATIC_DIR=/app/dist

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
# Types, parsers, helpers and the domain logic the server shares with the
# frontend live in shared/ (imported as #shared/...); the server never imports
# from src/, so frontend code stays out of the image.
COPY shared ./shared
COPY --from=builder /app/dist ./dist

# The commit the image was built from (.github/workflows/docker.yml), logged at
# start-up. Late in the file so a new commit doesn't invalidate the layers above.
ARG GIT_SHA=dev
ENV APP_VERSION=$GIT_SHA

# /backups exists owned by node, so a fresh volume mounted there is writable.
RUN mkdir /data /backups && chown node:node /data /backups
VOLUME /data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
