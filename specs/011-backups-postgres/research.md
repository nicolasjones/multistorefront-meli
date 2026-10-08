# Research: Backups automáticos de la base de datos

## R1. Cómo Kestra se autoriza para escribir en `respaldos`

**Decision**: un rol de Postgres dedicado, `kestra_backups`, creado por la
propia migración de esta spec, con `LOGIN` pero **sin** ningún otro
privilegio salvo `EXECUTE` sobre las tres funciones que necesita
(`iniciar_respaldo`, `finalizar_respaldo_completado`,
`finalizar_respaldo_error`). Kestra se conecta con este rol directo a
Postgres (JDBC), no a través de PostgREST/Supabase Auth.

**Rationale**: Kestra es un proceso de backend, no una sesión de usuario
— nunca va a tener un JWT de Supabase Auth ni `auth.uid()` poblado. Darle
la `service_role` (que todo lo puede, RLS incluido) sería mucho más
privilegio del que necesita — viola el principio de mínimo privilegio que
ya sigue el resto del repo (p. ej. la cuenta de servicio de Superset en la
spec 007, creada con el único permiso que necesita). Un rol dedicado con
`EXECUTE` acotado a 3 funciones puntuales es el equivalente para este
caso.

**Alternatives considered**:
- `service_role` directo: descartado — rompe el principio de mínimo
  privilegio sin necesidad real.
- Reusar el patrón de RPC `authenticated` + `private.is_superadmin()` que
  usan el resto de las specs (003-009): descartado, ver R2.

## R2. Por qué las funciones de escritura no usan `private.is_superadmin()`

**Decision**: `iniciar_respaldo`, `finalizar_respaldo_completado` y
`finalizar_respaldo_error` no verifican `private.is_superadmin()`
internamente. Su única protección es que nadie más que `kestra_backups`
tiene `EXECUTE` sobre ellas (`revoke ... from public, authenticated`).

**Rationale**: `private.is_superadmin()` depende de `auth.uid()`, un GUC
que solo se puebla en conexiones que pasan por PostgREST con un JWT de
Supabase Auth válido. Una conexión JDBC directa de Kestra nunca tiene eso
poblado — `auth.uid()` da `null`, y la función devolvería `false` siempre,
rompiendo el mecanismo. El límite de autorización acá es distinto pero
igual de real: "quién tiene la credencial de `kestra_backups`" (que vive
únicamente en `infra/kestra/.env`, nunca en Git ni en el navegador —
Principio I), en vez de "quién tiene una sesión de Supabase Auth con rol
superadmin".

**Alternatives considered**:
- Forzar que Kestra pase por PostgREST con una API key: agrega
  complejidad e infraestructura (Principio V) sin ganar nada — PostgREST
  no fue diseñado para llamadas servicio-a-servicio de este tipo.

## R3. Cómo se ejecuta `pg_dump` desde Kestra

**Decision**: una tarea de Kestra con *task runner* Docker (ya soportado
por la imagen `kestra/kestra:v1.3.35` — `infra/kestra/compose.yaml` ya
monta `/var/run/docker.sock`), levantando un contenedor `postgres` (misma
familia de imagen que ya usa Supabase) solo para correr `pg_dump` contra
la base del entorno, y dejar el archivo resultante en el storage interno
de Kestra (volumen `kestra-data`, ya existente).

**Rationale**: cero infraestructura nueva — el socket de Docker ya estaba
montado (aparentemente para este tipo de caso). No hace falta una imagen
custom de Kestra con `postgresql-client` preinstalado.

**Alternatives considered**:
- Imagen custom de Kestra con herramientas de Postgres preinstaladas:
  descartado — más mantenimiento (rebuild en cada bump de versión de
  Postgres) por un beneficio marginal.

## R4. Cómo se conecta Kestra a Postgres en cada entorno

**Decision**: en desarrollo local, `host.docker.internal:5434` (mismo
patrón ya usado por `pnpm test:db:ci`, `scripts/reset-db-ci.sh`) con las
credenciales fijas locales del CLI de Supabase. En staging/producción, una
cadena de conexión propia de ese entorno, guardada únicamente en el
`infra/kestra/.env` de ese entorno (nunca en el repo).

**Rationale**: reutiliza un patrón de conectividad que el repo ya validó
(CI), en vez de inventar uno nuevo. Cumple FR-009 (mismo comportamiento en
todos los entornos, solo cambia el destino).

## R5. Qué pasa si Kestra se cae a mitad de un backup

**Decision**: antes de insertar una fila nueva en `en_progreso`,
`iniciar_respaldo` primero marca como `error` cualquier fila que siga en
`en_progreso` con más de 3 horas desde su inicio ("Backup interrumpido:
quedó en progreso más de 3 horas sin resolverse"). Recién después intenta
insertar la fila nueva.

**Rationale**: sin esto, una caída real del proceso (no un fallo de tarea
capturado por el bloque `errors:` de Kestra, sino que el propio worker o
contenedor muere) dejaría una fila en `en_progreso` para siempre — y el
índice único que impide dos backups simultáneos (FR-003) bloquearía todo
backup futuro de forma permanente. El umbral de 3 horas es un default
razonable (ningún backup de este mecanismo debería tardar tanto); se
documenta como tal, ajustable si hiciera falta.

**Alternatives considered**:
- Un proceso "watchdog" aparte que revise filas colgadas: más
  infraestructura por el mismo resultado — se descarta (Principio V), el
  chequeo cabe en la misma función que ya se llama al arrancar cada
  backup.

## R6. Por qué no se expone un webhook público para el disparo manual

**Decision**: el disparo manual (US2) pasa por el acceso directo del
superadmin a la propia interfaz de Kestra (usuario/contraseña ya
configurados, `KESTRA_BASIC_AUTH_*`) — no se agrega ningún endpoint nuevo
expuesto desde Refine ni públicamente.

**Rationale**: mismo patrón que ya usa el superadmin para Superset (spec
007, acceso directo con su propia URL y login). Menor superficie de
ataque, cero infraestructura nueva.

## R7. Cómo se versiona el flow de Kestra

**Decision**: el flow vive como YAML versionado en
`infra/kestra/flows/respaldo-postgres.yml`, comiteado en Git. Se aplica al
Kestra corriendo mediante su API (`kestra flow validate` /
`kestra flow namespace update`, documentado paso a paso en
`quickstart.md`) — nunca se crea o edita solo desde la UI.

**Rationale**: mismo principio ya aplicado a los dashboards de Superset
("se exportan a YAML y se commitean, nunca quedan solo en la UI") — lo que
se entrega es código versionado en git.

## R8. Cómo se maneja la contraseña de `kestra_backups` sin commitearla

**Decision**: la migración crea el rol sin contraseña operativa
(`with login password 'reemplazar-en-cada-entorno'` o equivalente,
claramente marcado). Cada entorno la rota con
`alter role kestra_backups with password '...'` usando una variable nueva,
`KESTRA_BACKUPS_DB_PASSWORD`, agregada a `.env.example`. `quickstart.md`
documenta el paso para desarrollo local.

**Rationale**: mismo patrón ya usado para
`SUPERSET_GUEST_TOKEN_USERNAME`/`PASSWORD` (spec 007) — la migración deja
la estructura, el valor real nunca entra a Git.
