# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
COPY workers ./workers
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_NANGO_PUBLIC_SERVER_URL
# MSF-241 (FR-007): hosts del panel. Sin esto, el front público no enruta ninguna
# tienda y todo host sirve el panel (falla seguro). Debe incluir el dominio del panel
# del entorno; los dominios de tienda son los que NO figuran acá.
ARG VITE_PANEL_HOSTS=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_NANGO_PUBLIC_SERVER_URL=$VITE_NANGO_PUBLIC_SERVER_URL
ENV VITE_PANEL_HOSTS=$VITE_PANEL_HOSTS
WORKDIR /workspace/apps/web
RUN pnpm build
FROM nginx:alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
