# Contrato: Variables de Puerto de Desarrollo Local

Cada fila es una variable de entorno nueva (o, en el caso de
`KESTRA_ALERTAS_WEBHOOK_URL`, una variable existente cuyo *default* deja de
tener el puerto suelto). El valor por defecto es siempre el puerto que el
template usa hoy — ningún checkout sin `.env` cambia de comportamiento
(FR-009).

| Variable | Default | Archivos que la consumen |
|---|---|---|
| `WEB_PORT` | `3100` | `infra/refine/compose.yaml` (host y contenedor), `infra/refine/Dockerfile` (`ARG`/`EXPOSE`), `apps/web/vite.config.ts` (`server.port`, `preview.port`), `infra/superset/superset_config.py` (`REFINE_ORIGIN` fallback + orígenes CORS), `.env.example` (`REFINE_ORIGIN` default), `supabase/functions/.env.example` (`APP_URL` default, usado por `invitar-miembro` para el link de invitación) |
| `SUPABASE_API_PORT` | `8100` | `apps/web/.env.example` (`VITE_SUPABASE_URL`) |
| `SUPABASE_DB_PORT` | `5434` | `package.json` (`test:db:ci`), `scripts/reset-db-ci.sh`, `infra/kestra/compose.yaml` (defaults de `KESTRA_BACKUPS_DB_URL`, `KESTRA_BACKUPS_PGDUMP_URL`, `KESTRA_ORQUESTACION_DB_URL`), `.env.example` (mismos defaults) |
| `SUPABASE_DB_SHADOW_PORT` | `5433` | — (solo excepción, ver abajo) |
| `SUPABASE_POOLER_PORT` | `54329` | — (solo excepción, pooler deshabilitado por defecto) |
| `SUPABASE_STUDIO_PORT` | `3101` | — (solo excepción) |
| `SUPABASE_MAILPIT_PORT` | `3102` | — (solo excepción) |
| `SUPABASE_EDGE_INSPECTOR_PORT` | `8083` | — (solo excepción) |
| `SUPABASE_ANALYTICS_PORT` | `54327` | — (solo excepción, analytics deshabilitado por defecto) |
| `KESTRA_PORT` | `8082` | `infra/kestra/compose.yaml` |
| `SUPERSET_PORT` | `8088` | `infra/superset/compose.yaml` (mapeo host — el bind interno de gunicorn y el healthcheck siguen en `8088` dentro del contenedor, no cambian), `supabase/functions/.env.example` (`SUPERSET_PUBLIC_URL` default) |
| `PLAYWRIGHT_PORT` | `3103` | `infra/playwright/compose.yaml`, `infra/playwright/compose.vps.yaml` |
| `KESTRA_ALERTAS_WEBHOOK_URL` *(ya existía)* | `http://host.docker.internal:8099/alertas` | `infra/kestra/compose.yaml`, `.env.example` — deja de tener el puerto `8099` como número aislado repetido; sigue siendo una URL completa overrideable como hoy |
| `NANGO_PORT` *(spec `20260930-153545-conexiones-oauth-nango`)* | `3003` | `infra/nango/compose.yaml` (mapeo host y defaults de `NANGO_SERVER_URL`/`NANGO_PUBLIC_SERVER_URL`), `.env.example` |

## Filas marcadas "solo excepción"

Las cinco variables sin archivo consumidor fuera de `supabase/config.toml`
existen igual en este contrato — son la mitad "declarada" de la
correspondencia de `data-model.md`, aunque ningún archivo las lea por
variable (no pueden, ver research.md §5). Sirven como referencia para quien
edita `config.toml` a mano: ese archivo debe llevar un comentario que
nombre cada una.

## Regla de consistencia

Ningún valor de puerto por defecto (columna `Default`) puede aparecer como
literal en ningún archivo fuera de:
1. Esta tabla y `.env.example` (donde se declara el default),
2. El propio archivo consumidor leyendo la variable con ese mismo default
   como fallback (`${WEB_PORT:-3100}`, `process.env.WEB_PORT ?? 3100`, etc.),
3. `supabase/config.toml`, señalado con su comentario de excepción.

Esta regla es la que `pnpm infra:config` + una búsqueda de texto por cada
puerto (SC-002 de la spec) deben poder verificar.
