# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check`. Controla versiones únicas, inmutables y nuevas, y la
idempotencia del DDL de las migraciones **nuevas** respecto de `origin/dokploy`.

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
(`$$...$$`, `$tag$...$tag$`): ese texto no se ejecuta como SQL (es el cuerpo de una plantilla de
SQL dinámico) y por eso no marca la migración. El enmascarado conserva la longitud y los saltos
de línea del original, así la línea informada es la real.

La lógica vive en `scripts/guard-migraciones-ddl.mjs` y se prueba con
`pnpm test:db:guard-migraciones` (`scripts/guard-migraciones-ddl.test.mjs`), que corre en el CI
de validación.

## Migraciones históricas

El guard sólo revisa los archivos **nuevos** respecto de la base: las migraciones históricas con
`ADD COLUMN` multilínea sin guard no se vuelven a evaluar (además, una versión ya publicada es
inmutable salvo para agregar guards). Una migración en vuelo con esa forma debe agregar
`IF NOT EXISTS`.
