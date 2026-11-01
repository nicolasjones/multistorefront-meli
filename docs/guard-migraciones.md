# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check`. Controla versiones únicas, inmutables y nuevas, y la
idempotencia del DDL de las migraciones **nuevas** respecto de `origin/dokploy`.

## ADD COLUMN sin IF NOT EXISTS (MSF-682)

La regla se evalúa por **sentencia completa** (hasta `;`), no por línea. Por eso detecta
`alter table t` + `add column x` en líneas distintas, y cada `add column` sin guard dentro de
un mismo `alter table` (la línea informada es la del `add column`). Los comentarios (`--`,
`/* */`) y los literales `'...'` se ignoran. La lógica vive en `scripts/detectar-add-column.mjs`
y se prueba con `pnpm test:db:guard-migraciones`.

Las migraciones históricas con la forma multilínea no se vuelven a evaluar (el guard sólo
revisa archivos nuevos); una migración en vuelo con esa forma debe agregar `IF NOT EXISTS`.
