---
owner: plataforma
sources:
  - scripts/guard-migraciones-ddl.mjs
  - scripts/verificar-migraciones.mjs
---

# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check`. Controla versiones únicas, inmutables y nuevas, y la
idempotencia del DDL de las migraciones **nuevas** respecto de `origin/dokploy`.

## Qué revisa (y qué no): el alcance es la rama, no el árbol entero

El guard juzga **las migraciones propias de la rama**: las que agregó, renombró o modificó
desde el punto de divergencia con la base (`git merge-base <base> HEAD`). Lo que la rama
heredó sin tocar queda **fuera** del alcance, aunque la base lo haya renumerado después.

Por qué (MSF-749): la base renumera migraciones casi todos los días y de vez en cuando deja
**dos migraciones con la misma versión** (el 2026-11-02 dejó `20270121120000` en
`20270121120000_alertas_inicio_tabla.sql` y `20270121120000_cortar_sesiones_miembro_removido.sql`).
Con el alcance anterior (el árbol entero contra la punta de la base), **toda** rama que
heredó ese conflicto quedaba `BEHIND` con el job `application` en rojo por «versión
duplicada …» o «versión … MODIFICADA» de migraciones que ese PR no había tocado: 13 PRs
abiertos, ninguno mergeable, y la base seguía avanzando.

Lo que **no** se pierde:

- La comparación de colisiones sigue siendo contra la **punta** de la base: si la rama
  agrega una migración con una versión que la base ya aplicó, o pisa una versión que la
  base reservó después de la divergencia, el guard sigue fallando.
- Si la base renumeró algo que la rama heredó, el guard **avisa** (no falla) con una
  instrucción accionable: «la base `origin/dokploy` renumeró o quitó N migración(es) que tu
  rama heredó: actualizá tu rama (merge de `origin/dokploy`) antes de mergear».
- Sin punto de divergencia resoluble (clone superficial sin ancestro común) el guard cae a
  `HEAD~1`; si tampoco puede, revisa el árbol entero (comportamiento previo).

El CI corre el guard sobre el **merge** de la base en la rama (`refs/pull/N/merge`), no
sobre la rama sola: por eso el alcance se calcula contra el punto de divergencia con la
punta de la base y no contra la punta de la base con el árbol de la rama.

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
`pnpm test:db:guard-migraciones` (`scripts/guard-migraciones-ddl.test.mjs`, `scripts/verificar-migraciones-ddl.test.mjs` y `scripts/verificar-migraciones.multilinea.test.mjs`, que cubre las sentencias de varias líneas), que corre en el CI
de validación.

## Migraciones históricas

El guard sólo revisa los archivos **nuevos** respecto de la base: las migraciones históricas con
`ADD COLUMN` multilínea sin guard no se vuelven a evaluar (además, una versión ya publicada es
inmutable salvo para agregar guards). Una migración en vuelo con esa forma debe agregar
`IF NOT EXISTS`.
