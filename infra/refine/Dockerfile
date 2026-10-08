FROM node:24-alpine

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web

# Puerto configurable (spec 015) — valor informativo alineado a la misma
# variable que usa el resto del stack (WEB_PORT); no publica el puerto por sí
# solo (eso lo controla `ports:` en compose.yaml), pero evita que quede
# desactualizado sin que nadie lo note.
ARG WEB_PORT=3100
EXPOSE $WEB_PORT

CMD ["pnpm", "--filter", "@platform/web", "dev", "--host", "0.0.0.0"]
