# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM dependencies AS source
COPY . .
RUN npm run db:generate

FROM dependencies AS ci
RUN npx playwright install --with-deps chromium
COPY . .
RUN npm run db:generate
CMD ["bash", "deploy/ci/verify.sh"]

FROM source AS migration
WORKDIR /app/backend
# Separate Linux job; never run migrations in API startup.
ENTRYPOINT ["bash", "/app/deploy/migrate.sh"]

FROM source AS build
ENV VITE_API_URL=/api/v1 VITE_SOCKET_URL=/ VITE_API_DOCS_URL="" VITE_LOCATION_MODE=REAL
RUN npm run build

FROM dependencies AS production-dependencies
# Prisma CLI is an optional peer of @prisma/client; --omit=dev alone retains it.
RUN npm ci --omit=dev --omit=optional --omit=peer --workspace backend --include-workspace-root=false

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --chown=node:node deploy/healthcheck.mjs ./deploy/healthcheck.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD ["node", "deploy/healthcheck.mjs"]
CMD ["node", "backend/dist/main.js"]

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 AS frontend
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
