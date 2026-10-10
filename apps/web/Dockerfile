# syntax=docker/dockerfile:1
# Prod build para Dokploy (Vite SPA -> nginx)
# Contexto esperado: raíz del repo (Dokploy: Build Context = /)
# Usa pnpm workspace. Solo instala lo necesario para @platform/web.

FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /workspace

# Caches: copiar manifests primero
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
# Si hay packages vinculados, copiar manifests mínimos para resolver workspace:*
COPY packages ./packages
COPY workers ./workers
# Instalar deps filtradas (si no hay packages/workers reales, igual funciona por workspace:*)
RUN pnpm install --frozen-lockfile

# Copiar fuentes web y configs necesarias
COPY apps/web ./apps/web
COPY tsconfig.json ./tsconfig.json

# Args VITE_* baked at build time (SPA). Dokploy los pasa como build args/env.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_NANGO_PUBLIC_SERVER_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_NANGO_PUBLIC_SERVER_URL=$VITE_NANGO_PUBLIC_SERVER_URL

WORKDIR /workspace/apps/web
RUN pnpm build

FROM nginx:alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
