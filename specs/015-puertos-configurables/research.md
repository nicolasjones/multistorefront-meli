# Research: Puertos de Desarrollo Local Configurables

No quedaron `[NEEDS CLARIFICATION]` en el Technical Context del plan — las
decisiones técnicas ya estaban resueltas por investigación hecha antes de
escribir la spec (incluida una verificación externa sobre el límite real del
CLI de Supabase). Este documento deja constancia de esas decisiones y sus
alternativas descartadas.

## 1. Puertos de Docker Compose

**Decision**: Cada `ports:` en `infra/*/compose.yaml` pasa de literal a
interpolación nativa de Compose, `${VARIABLE:-valor-actual}` — el valor por
defecto es exactamente el puerto que el template usa hoy.

**Rationale**: Docker Compose soporta interpolación de variables de entorno de
forma nativa desde siempre; no agrega dependencia ni paso de build. Con
default embebido, un checkout sin `.env` sigue arrancando igual que hoy
(FR-009).

**Alternatives considered**:
- Script que reemplaza puertos con `sed` antes de levantar Compose — rechazado:
  reintroduce el mismo patrón fragil de edición de texto que esta spec existe
  para eliminar, solo que automatizado en vez de manual.
- Archivo `.env.ports` separado cargado con `--env-file` — rechazado por
  indirección innecesaria: cada `infra/<producto>/compose.yaml` ya espera su
  propio `.env` copiado ahí (convención documentada en el `.env.example` raíz
  actual), Compose ya lo carga solo.

## 2. Puerto del servidor de desarrollo de Vite

**Decision**: `apps/web/vite.config.ts` lee `process.env.WEB_PORT` (con
fallback al puerto actual) tanto en `server.port` como en `preview.port`.

**Rationale**: `vite.config.ts` se ejecuta en Node al arrancar, no en el
bundle del navegador — `process.env` está disponible ahí directamente, sin
necesitar el prefijo `VITE_` (que es solo para variables expuestas al código
de cliente).

**Alternatives considered**: dejarlo fijo y confiar solo en el remapeo de
puerto de Docker Compose — rechazado: es exactamente la clase de bug que
apareció en el fork real (el puerto interno de Vite tiene que coincidir con
los redirects de Supabase Auth y el CORS de Superset, no alcanza con que
Compose remapee el lado del host).

## 3. CORS de Superset

**Decision**: `infra/superset/superset_config.py` deriva los orígenes
permitidos de una sola variable (la misma `REFINE_ORIGIN` que ya usa), sin
los dos literales fijos adicionales (`http://localhost:3100`,
`http://127.0.0.1:3100`) que hoy conviven con ella.

**Rationale**: el archivo ya tiene el patrón correcto para un origen
(`os.environ.get("REFINE_ORIGIN", ...)`) — el problema no es el mecanismo,
es que los otros dos orígenes de la misma lista quedaron como literales
independientes que hay que mantener sincronizados a mano. Fue justo uno de
los tres puntos que se pasaron por alto en el primer barrido del fork real.

**Alternatives considered**: ninguna — es una corrección de consistencia
sobre un patrón que el archivo ya usa bien para el caso principal.

## 4. `EXPOSE` de `infra/refine/Dockerfile`

**Decision**: se documenta como valor informativo alineado a la misma
variable (`WEB_PORT`) vía `ARG` con default igual al puerto actual, en vez de
dejar el número suelto.

**Rationale**: `EXPOSE` no publica el puerto por sí solo (eso lo controla
`ports:` en el compose) — es metadata para quien inspecciona la imagen. Pero
dejarlo como literal independiente es exactamente el tipo de referencia que
se pasó por alto en el fork real; alinearlo evita que quede desactualizado
sin que nadie lo note.

**Alternatives considered**: quitar `EXPOSE` — rechazado, sigue siendo
documentación útil para quien lee el Dockerfile o usa herramientas que lo
inspeccionan.

## 5. Excepción confirmada: `supabase/config.toml`

**Decision**: sus puertos (`[api] port`, `[db] port`/`shadow_port`,
`[db.pooler] port`, `[studio] port`, `[local_smtp] port`,
`[edge_runtime] inspector_port`, `[analytics] port`) y el bloque
`[auth] site_url` / `additional_redirect_urls` quedan como literales, con un
comentario junto a cada uno que indica la variable de `.env.example` con la
que debe mantenerse alineado a mano.

**Rationale**: confirmado por investigación externa — el CLI de Supabase solo
soporta la función `env()` en campos de tipo *string* (API keys, tokens,
passwords); los campos *integer* (todos los puertos) no la soportan. Es un
feature request abierto y sin resolver del propio proyecto
([supabase/cli#1551](https://github.com/supabase/cli/issues/1551)), no una
decisión de diseño de este template.

**Alternatives considered**:
- Script que regenera `config.toml` desde una plantilla antes de
  `supabase start` — rechazado: agrega un paso de build al camino más básico
  ("cloná y corré"), desproporcionado para el beneficio, y arriesga
  desalinearse si alguien corre el CLI de Supabase directo sin pasar por el
  wrapper.
- Esperar a que el CLI soporte `env()` en enteros — rechazado como bloqueante:
  sin ETA público, y la necesidad ya es real hoy.

## 6. Convención de nombres de variable

**Decision**: prefijo por servicio, sufijo `_PORT`: `WEB_PORT`,
`SUPABASE_API_PORT`, `SUPABASE_DB_PORT`, `SUPABASE_DB_SHADOW_PORT`,
`SUPABASE_POOLER_PORT`, `SUPABASE_STUDIO_PORT`, `SUPABASE_MAILPIT_PORT`,
`SUPABASE_EDGE_INSPECTOR_PORT`, `SUPABASE_ANALYTICS_PORT`, `KESTRA_PORT`,
`SUPERSET_PORT`, `PLAYWRIGHT_PORT`.

**Rationale**: consistente con el resto de `.env.example` (que ya usa
prefijos por servicio, p. ej. `KESTRA_*`, `SUPERSET_*`).

**Nota sobre el webhook de alertas**: `KESTRA_ALERTAS_WEBHOOK_URL` ya es una
variable de entorno que acepta una URL completa (no solo un puerto) — el
mecanismo de override ya existe; lo único que cambia con esta spec es que su
valor por *defecto* dentro de `infra/kestra/compose.yaml` y `.env.example`
pase a construirse a partir del puerto por defecto en vez de tener el número
suelto ahí también. No necesita una variable `_PORT` nueva.
