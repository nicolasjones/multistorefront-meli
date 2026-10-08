# Adoptar la base de datos del CI aislada

Capacidad `isolated-ci-database` de `template-capabilities.json`. Hace que el
job `database` del CI use un stack de Supabase propio (`ci-<repo>`, puertos
`20000 + p % 10000`), en vez del stack de desarrollo que comparte el Docker del
host con los runners self-hosted. El diseño está en `docs/deployment.md`
("Stack de Supabase propio del CI").

Mientras un producto derivado no la adopte, su CI sigue reseteando el
`host.docker.internal:5434` por defecto, es decir, **la base de desarrollo del
template**, y sus pgTAP corren contra esa base. **No** se corrige cambiando el
puerto del CI al de desarrollo del producto: borraría sus datos.

## Qué traer

1. `scripts/supabase-ci.mjs`, `scripts/supabase-ci.test.mjs` y
   `scripts/reset-db-ci.mjs`. Si el producto dropea más esquemas propios en su
   reset, conservarlos: lo único obligatorio es que la primera acción sea
   `await verificarDestinoCiActual()` y que no quede puerto por defecto.
2. En `package.json`: `db:ci:preparar` y el `test:db:ci` que corre
   `node scripts/supabase-ci.mjs verificar` antes de `pg_prove` y usa
   `$SUPABASE_DB_PORT` sin default.
3. `.supabase-ci/` en `.gitignore`.
4. El job `database` de `.github/workflows/validate.yml`: `concurrency`,
   `node --test scripts/supabase-ci.test.mjs`, `pnpm db:ci:preparar`, `supabase
   start --workdir "$SUPABASE_CI_WORKDIR" -x …`, `pnpm db:reset:ci` y `pnpm
   test:db:ci`. Borrar cualquier `SUPABASE_DB_PORT` fijo del workflow.
5. Registrar `isolated-ci-database` en `template-adoption.json`.

`supabase/config.toml` del producto no se toca: el stack del CI se deriva de
sus puertos de desarrollo.

## estudio-contable-automation

| | Desarrollo (no se toca) | CI |
| --- | --- | --- |
| project_id | `estudio-contable-automation-supabase-dev` | `ci-estudio-contable-automation` |
| Base | 6434 | 26434 |
| API | 9100 | 29100 |

`scripts/supabase-ci.test.mjs` ya cubre estos puertos: el stack de CI del
producto no choca con el del template ni con ninguno de desarrollo.

## Validar la adopción

En el PR de adopción, crear una tabla centinela en la base de desarrollo del
template (5434), que es la que hoy borra el CI del producto. Dejar que corra
el job `database` y verificar que la tabla siga ahí, que el log muestre
`Destino verificado: ci-estudio-contable-automation en el puerto 26434` y que
`docker ps` muestre `supabase_db_ci-estudio-contable-automation` en 26434.
Después borrar la centinela. La base de desarrollo del producto, con datos
reales, no se usa como centinela: basta con comprobar con `docker ps` que su
contenedor no se reinició. Es el mismo procedimiento que registra
`.specify/bugs/ci-supabase-desarrollo-compartido/test.md` en el template.
