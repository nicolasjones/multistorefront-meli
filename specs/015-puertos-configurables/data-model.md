# Data Model: Puertos de Desarrollo Local Configurables

No hay entidades de base de datos en esta feature (sin migraciones, sin
tablas). La única "entidad" relevante es de configuración: la variable de
puerto y los archivos que deben mantenerse consistentes con ella.

## Variable de puerto

Representa el puerto local de un servicio del stack de desarrollo.

| Campo | Descripción |
|---|---|
| `nombre` | Nombre de la variable de entorno, prefijo por servicio + sufijo `_PORT` (ver research.md §6). |
| `valor_por_defecto` | El puerto que el template usa hoy — garantiza cero regresión sin `.env` (FR-009). |
| `archivos_consumidores` | Lista de archivos que deben leer esta variable en vez de tener el número como literal (compose.yaml, vite.config.ts, superset_config.py, Dockerfile). |
| `excepcion` | `true` únicamente para los puertos de `supabase/config.toml` — ahí el valor sigue siendo literal por la limitación del CLI (research.md §5), pero debe llevar un comentario que nombre la variable equivalente del resto del stack. |

## Relación entre variable y archivo de excepción

`supabase/config.toml` no consume ninguna variable de puerto (no puede, por
la limitación del CLI), pero cada uno de sus valores de puerto **corresponde**
a una variable de esta tabla — esa correspondencia es la que el comentario
explícito debe dejar trazable (FR-006), para que cambiar la variable en
`.env` recuerde a quien lo hace que también tiene que tocar `config.toml` a
mano.

| Puerto en `supabase/config.toml` | Variable equivalente |
|---|---|
| `[api] port` | `SUPABASE_API_PORT` |
| `[db] port` | `SUPABASE_DB_PORT` |
| `[db] shadow_port` | `SUPABASE_DB_SHADOW_PORT` |
| `[db.pooler] port` | `SUPABASE_POOLER_PORT` |
| `[studio] port` | `SUPABASE_STUDIO_PORT` |
| `[local_smtp] port` | `SUPABASE_MAILPIT_PORT` |
| `[edge_runtime] inspector_port` | `SUPABASE_EDGE_INSPECTOR_PORT` |
| `[analytics] port` | `SUPABASE_ANALYTICS_PORT` |
| `[auth] site_url` / `additional_redirect_urls` | `WEB_PORT` |
