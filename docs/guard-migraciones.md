# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check`. Controla versiones únicas, inmutables y nuevas, y la
idempotencia del DDL de las migraciones **nuevas** respecto de `origin/dokploy`.

## Nombre del archivo

Todo archivo de `supabase/migrations/` tiene que llamarse `<versión>_<nombre>.sql`. El CLI de Supabase y el cron que aplica
las migraciones en dev, staging y producción (`migrar-supabase-vps.sh`) **ignoran** un archivo sin nombre
(`20270202200501.sql`), mientras que el CI aplica todos los `.sql`: la migración pasa las pruebas pero nunca llega a la base.
Así quedaron sin aplicar en dev las tres migraciones de seguridad MSF-724 del chat de IA, hasta que se las renombró
(`20270202200501_…`, `…502_…`, `…503_…`). La guarda rechaza cualquier archivo con nombre inválido (`nombre inválido …`).
Renombrar una migración sin nombre ya publicada, **sin cambiar su contenido**, no cuenta como versión reusada ni como
migración nueva (tampoco se le revisa la idempotencia); si además se cambia el contenido, sigue siendo `MODIFICADA`.

## Reglas de idempotencia del DDL

Todas las reglas se evalúan por **sentencia completa** (hasta `;`), no línea por línea: por eso
`alter table t` + `add column x` en líneas distintas es el mismo problema que
`alter table t add column x int` (MSF-682), y un `create index` con `if not exists` en la línea
siguiente NO se marca como problema.

| Regla | Severidad | Guard que evita el reintento trabado |
|-------|-----------|--------------------------------------|
| `ADD COLUMN` | problema | `IF NOT EXISTS` |
| `DROP FUNCTION` | problema | `IF EXISTS` |
| `CREATE INDEX` | problema | `IF NOT EXISTS` |
| `DROP TABLE/VIEW/INDEX/TRIGGER` | aviso | `IF EXISTS` |
| `CREATE TABLE` | aviso | `IF NOT EXISTS` |

La línea informada es la de la palabra clave dentro de la sentencia (para `ADD COLUMN`, la del
`add column`).

Antes de leer el SQL se **enmascaran** los comentarios (`--`, `/* */`), los literales (`'...'`,
`E'...'`), los identificadores entre comillas dobles (`"..."`) y los cuerpos dollar-quoted
que son plantillas de SQL dinámico (`execute $q$...$q$`, `format($q$...$q$)`): ese texto no se
ejecuta al aplicar la migración y no la marca. El cuerpo de un `DO $$...$$` o de una función
(`... AS $$...$$`) **sí** se ejecuta como PL/pgSQL y **no** se enmascara: su DDL se evalúa igual
que el de nivel superior. `CONCURRENTLY` se acepta junto al guard (`CREATE [UNIQUE] INDEX
CONCURRENTLY IF NOT EXISTS`, `DROP INDEX CONCURRENTLY IF EXISTS`). El enmascarado conserva la longitud y los saltos
de línea del original, así la línea informada es la real.

La lógica vive en `scripts/guard-migraciones-ddl.mjs` y se prueba con
`pnpm test:db:guard-migraciones` (`scripts/guard-migraciones-ddl.test.mjs` y `scripts/verificar-migraciones-ddl.test.mjs`), que corre en el CI
de validación.

## Migraciones históricas

El guard sólo revisa los archivos **nuevos** respecto de la base: las migraciones históricas con
`ADD COLUMN` multilínea sin guard no se vuelven a evaluar (además, una versión ya publicada es
inmutable salvo para agregar guards). Una migración en vuelo con esa forma debe agregar
`IF NOT EXISTS`.
