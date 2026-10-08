# Operar Superset local

Conocimiento operativo encontrado al ejercitar por primera vez la analítica
embebida (spec 007) contra datos reales en un producto derivado — no es una
funcionalidad de negocio, es infraestructura/configuración que cualquier
producto derivado que use este Superset va a pisar igual. `infra/superset/`
tiene la configuración real (`superset_config.py`,
`crear_cuenta_servicio_guest_token.py`, `configurar_embebido.py`,
`compose.yaml`).

## Qué se configura solo en cada `superset-init`

La analítica embebida depende de tres piezas de estado que antes se cargaban
a mano y se perdían al recrear contenedores o volúmenes. Ahora las deja
listas `compose.yaml` y `configurar_embebido.py`, que corre en
`superset-init` después de `crear_cuenta_servicio_guest_token.py`. El script
es idempotente y solo agrega: nunca saca un permiso ni un dominio cargado a
mano. Imprime `configurar_embebido: N cambios` con el detalle.

Dashboards o embeds creados en la UI después del init se cubren volviendo a
correr el init (no recrea `superset`):

```sh
docker compose -f infra/superset/compose.yaml run --rm superset-init
```

### Red cruzada entre proyectos Docker

Las Edge Functions de Supabase y Superset son de dos proyectos Compose
distintos, cada uno con su propia red. `emitir-acceso-reporte` llama a
`http://superset:8088`, así que el servicio `superset` se une a la red que
crea `supabase start` (`supabase_network_<project_id>`) con alias
`superset`. `host.docker.internal` no sirve: el runtime de Edge Functions
sandboxea la red de cada isolate.

- La red se declara `external`: **Supabase tiene que estar levantado antes**
  que `pnpm dev:superset`. Si no, Compose falla con `network
  supabase_network_… declared as external, but could not be found`.
- Un producto derivado cambia el default del nombre de red en
  `compose.yaml` por su `project_id` de `supabase/config.toml`, o define
  `SUPABASE_DOCKER_NETWORK` en `infra/superset/.env`.
- `compose.vps.yaml` la saca: en el VPS no hay stack local de Supabase.
- `emitir-acceso-reporte` corta cada llamada a Superset a los 10 s. Si falta
  la red, devuelve 503 `analitica_no_disponible` en vez de colgarse hasta el
  wall-clock.

### Orígenes permitidos del embed

Superset rechaza con 403 la carga del iframe (`GET /embedded/<uuid>`) si el
`Referer` no está en `allow_domain_list` del embed. El script agrega a cada
embed los mismos orígenes que `CORS_OPTIONS` de `superset_config.py`:
`REFINE_ORIGIN` y las variantes `localhost`/`127.0.0.1` con `WEB_PORT`.
Si Refine cambia de puerto, alcanza con ajustar `WEB_PORT` en
`infra/superset/.env` y volver a correr el init. Superset y Refine tienen
que ver el mismo `WEB_PORT`: cada `compose.yaml` lee el `.env` de su propia
carpeta.

### Permisos del rol `Guest`

`GUEST_ROLE_NAME` (`"Guest"`) no trae de fábrica lo que un dashboard
embebido necesita. Hay dos capas: el bootstrap del SDK (sin ella el
navegador muestra "Something went wrong with embedded authentication") y el
pedido de datos de cada chart (sin ella cada chart muestra `"Data error:
Forbidden"`). El guest token resuelve *a qué* dashboard y a qué filas
accede (`resources`/RLS); el rol resuelve *qué puede hacer* adentro.

`configurar_embebido.py` (`PERMISOS_GUEST`) otorga:

| Permiso | View menu | Para qué |
|---|---|---|
| `can_read` | `CurrentUserRestApi` | bootstrap del SDK |
| `can_read` | `Dashboard` | bootstrap del SDK |
| `can_read` | `Chart`, `Dataset` | datos de cada chart |
| `can_get`, `can_external_metadata`, `can_external_metadata_by_name` | `Datasource` | datos de cada chart |
| `can_query`, `can_time_range`, `can_query_form_data` | `Api` | datos de cada chart |
| `can_csv` | `Superset` | exportar a CSV/Excel/imagen desde el menú "..." |
| `can_share_chart` | `Superset` | "Copy permalink"/"Share by email"; "Embed code" se bloquea aparte (sección siguiente) |
| `datasource_access` | cada dataset usado por un dashboard con embed | derivado de la metadata: charts y filtros nativos |

Si `superset init` no registra alguno de los pares fijos (nombre mal
escrito o cambio de versión de Superset), el script falla en vez de crear
un par que nadie chequea.

**A propósito NO se otorga** `can_view_query` (`Dashboard`): "View query" no
debe quedar visible para quien entra por guest token.

### Verificación de punta a punta

`pnpm test:superset:embebido` (`scripts/verificar-superset-embebido.mjs`)
recorre el mismo camino que el SDK, sin credenciales admin de Superset:
login en Supabase, `emitir-acceso-reporte` por cada reporte visible,
`GET /embedded/<uuid>` con el `Referer` de Refine y `POST
/api/v1/chart/data` de cada chart con el guest token. Nunca imprime tokens.

```sh
SUPABASE_URL=http://127.0.0.1:8100 SUPABASE_ANON_KEY=<anon> VERIFICAR_EMAIL=<usuario> VERIFICAR_PASSWORD=<password> WEB_ORIGIN=http://localhost:3100 pnpm test:superset:embebido
```

## "Embed code" no se puede aislar solo con permisos de rol

Superset agrupa "Copy permalink to clipboard", "Share chart by email" y
"Embed code" bajo el mismo permiso de rol (`can_share_chart`) — sacar el
permiso saca los tres juntos, no se puede aislar solo "Embed code" a nivel
de rol. Por eso `EMBEDDABLE_CHARTS` va en `False` en `FEATURE_FLAGS` de
`superset_config.py` (default real de Superset: `True`) en vez de resolverse
con permisos — así se conserva "Copy permalink"/"Share by email" sin
exponer "Embed code" a nadie. Requiere reiniciar el contenedor de Superset
para tomar el cambio (`docker restart` alcanza, no hace falta recrear — el
alias de red de arriba sobrevive un restart).

## Mapeo de UUIDs: dashboard propio vs. UUID de embedding

Cada dashboard tiene dos UUIDs distintos, fáciles de confundir:

- `dashboard.uuid` — identidad interna del dashboard en Superset.
- El UUID de **embedding** (`POST /api/v1/dashboard/<id>/embedded`) — es el
  que se usa como `dashboard_uuid` en el guest token y en la tabla de
  reportes de cada producto (spec 007). Son distintos: el título interno
  del dashboard en Superset no tiene por qué coincidir con el nombre de
  negocio que el producto le da al reporte.
