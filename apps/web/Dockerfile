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
# Dirección del manual de producto que enlaza la ayuda del panel: plantilla http(s) con {pagina}. Vacía = la de por defecto
# (apps/web/src/ayuda/manual.ts). Si el manual cambia de lugar se cambia acá (o allá), sin tocar las pantallas.
ARG VITE_MANUAL_URL=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_NANGO_PUBLIC_SERVER_URL=$VITE_NANGO_PUBLIC_SERVER_URL
ENV VITE_PANEL_HOSTS=$VITE_PANEL_HOSTS
ENV VITE_MANUAL_URL=$VITE_MANUAL_URL
WORKDIR /workspace/apps/web
RUN pnpm build
FROM nginx:alpine AS runner
# F-TDA-21: nginx proxea /robots.txt y /sitemap.xml a la Edge Function `tienda-seo`; la URL de Supabase y la
# clave pública (anon/publishable) salen de los mismos ARG que el build del front (no son secretos).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
# Sin URL de Supabase o sin clave pública el `proxy_pass` queda roto y robots/sitemap darían 500 sin aviso: el build falla.
RUN test -n "${VITE_SUPABASE_URL}" && test -n "${VITE_SUPABASE_PUBLISHABLE_KEY}" \
  || { echo "ERROR: VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY son obligatorios (build-arg): nginx los necesita para proxear robots.txt y sitemap.xml." >&2; exit 1; }
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s|__SUPABASE_URL__|${VITE_SUPABASE_URL%/}|; s|__SUPABASE_ANON_KEY__|${VITE_SUPABASE_PUBLISHABLE_KEY}|g" /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
