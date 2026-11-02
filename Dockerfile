# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY mcp/package.json mcp/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && mkdir -p apps/web/dist/downloads \
 && cp mcp/dist/index.js apps/web/dist/downloads/easy-kanban-mcp.mjs

# ---------- production dependencies (server only, from the npm cache) ----------
FROM build AS prod-deps
RUN rm -rf node_modules apps/*/node_modules mcp/node_modules \
 && npm ci --omit=dev --offline --no-audit --no-fund -w @easy-kanban/server

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web
WORKDIR /app
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist /app/web
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/dist/index.js"]
