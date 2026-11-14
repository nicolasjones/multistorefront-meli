# Guard de migraciones (`scripts/verificar-migraciones.mjs`)

Corre dentro de `pnpm docs:check` y compara `supabase/migrations` contra una base (`--base`, por defecto
`origin/dokploy`; en un PR, `origin/$GITHUB_BASE_REF`).

| Regla | Resultado |
|---|---|
| Versión duplicada en el árbol | error |
| Versión que ya existe en la base con otro contenido | error |
| DDL no idempotente en archivos nuevos | error |
| Versión nueva `<=` máxima de la base («REUSADA») | **error** si la base es una rama de épica, si el PR apunta a `dokploy`/`main` (`GITHUB_BASE_REF`) o con `--estricto`; **aviso** si no (corrida local/push contra `origin/dokploy`) |

## Por qué el orden contra `dokploy` es un aviso en una épica (MSF-672)

`dokploy` avanza con cada épica que mergea, así que la banda de una épica en curso queda siempre «por debajo» de su
máxima. Fallar ahí obligaba a renombrar migraciones legítimas en bucle (cada renombre se invalidaba con el siguiente
merge). La colisión real (duplicada o modificada) sigue siendo error.

El riesgo original sigue cubierto: el aplicador no ejecuta versiones por debajo de la cola ya aplicada (incidente
2026-10-23), por eso el orden es **error en el PR hacia `dokploy`/`main`**. Renumerar una sola vez, al integrar la épica.

Pruebas: `node --test scripts/verificar-migraciones.test.mjs` (parte de `pnpm test:tooling`).
