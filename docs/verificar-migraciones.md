---
owner: plataforma
sources:
  - scripts/verificar-migraciones.mjs
---

# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check` y compara `supabase/migrations` contra una base (`--base`, por defecto
`origin/dokploy`; en un PR, `origin/$GITHUB_BASE_REF`).
Un `--base` sin valor o vacío (`--base ""`) se rechaza con salida 2 en vez de caer en silencio a la base por omisión; un `GITHUB_BASE_REF` vacío (push sin PR) sí usa la base por omisión.

El alcance son **las migraciones propias de la rama** (las que agregó, renombró o modificó desde el
punto de divergencia con la base, `git merge-base`); las colisiones se comparan contra la **punta** de la
base. Lo que la rama heredó sin tocar no se juzga: si la base renumera migraciones o deja dos migraciones
con la misma versión, un PR que quedó atrás no es culpable (MSF-749). Detalle en
[guard-migraciones.md](guard-migraciones.md).

| Regla | Resultado |
|---|---|
| Versión duplicada en la rama | error |
| Versión que ya existe en la base con otro contenido | error |
| DDL no idempotente en archivos nuevos de la rama | error |
| Versión nueva `<=` máxima de la base («REUSADA») | **error** si la base es una rama de épica, si el PR apunta a `dokploy`/`main` (`GITHUB_BASE_REF`) o con `--estricto`; **aviso** si no (corrida local/push contra `origin/dokploy`) |
| La base renumeró migraciones que la rama heredó | **aviso**: actualizá tu rama (merge de la base) antes de mergear |

El CI corre el guard sobre el **merge** de la base en la rama (`refs/pull/N/merge`): el alcance es la
divergencia con la punta de la base, así que una rama que no toca migraciones no puede ser culpada por
lo que la base hizo después de divergir.


## Por qué el orden contra `dokploy` es un aviso en una épica (MSF-672)

`dokploy` avanza con cada épica que mergea, así que la banda de una épica en curso queda siempre «por debajo» de su
máxima. Fallar ahí obligaba a renombrar migraciones legítimas en bucle (cada renombre se invalidaba con el siguiente
merge). La colisión real (duplicada o modificada) sigue siendo error.

El riesgo original sigue cubierto: el aplicador no ejecuta versiones por debajo de la cola ya aplicada (incidente
2026-10-23), por eso el orden es **error en el PR hacia `dokploy`/`main`**. Renumerar una sola vez, al integrar la épica.

Pruebas: `node --test scripts/verificar-migraciones.test.mjs` (parte de `pnpm test:tooling`).
