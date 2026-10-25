---
owner: producto
sources: [apps/web/src, specs]
---
# Pruebas: qué corre según el cambio (determinista)

No se elige “a ojo”: el plan de pruebas sale del **diff**. La misma lista de
archivos produce siempre el mismo conjunto de suites, en el mismo orden.

```bash
pnpm test:afectados                     # plan contra origin/dokploy...HEAD
pnpm test:afectados --base origin/main  # otra base
pnpm test:afectados --archivos a.ts,b.sql
pnpm test:afectados --ejecutar          # corre el plan en orden (corta al fallar)
pnpm test:afectados --json              # plan como JSON (para CI/scripts)
```

Implementación: `scripts/tests-afectados.mjs` (`SUITES` + `seleccionarSuites`).
Tests: `scripts/tests-afectados.test.mjs`.

## Matriz

Además de **`lint`** y **`docs:check`** (siempre), según los archivos tocados:

| Archivos | Suites |
|---|---|
| `apps/web/**` | `web` (Vitest) |
| `apps/web/src/pages/**` | `web` + `e2e` (Playwright público) + `estilos` |
| `apps/web/src/components/**` | `web` + `e2e` |
| `supabase/migrations/**` | `db` (pgTAP) + `db:aditivas` |
| `supabase/tests/**` | `db` |
| `supabase/functions/**` | `edge` (3 funciones) |
| `packages/**` | `ia` |
| `scripts/**`, `.github/**` | `tooling` (`node --test scripts/*.test.mjs`) |
| `infra/**` | `infra:config` + `tooling` |
| `design/pantallas/**` | `prototipo` |
| `specs/**` | `matriz` |
| `docs/**`, `*.md` | (sólo `lint` + `docs`) |

## Qué comando ejecuta cada suite

| id | Comando |
|---|---|
| `lint` | `pnpm lint` |
| `docs` | `pnpm docs:check` |
| `web` | `pnpm --filter @platform/web test` |
| `estilos` | `pnpm estilos:check && pnpm test:estilos:sueltos` |
| `e2e` | `pnpm test:e2e -- acceso-publico.e2e.ts` |
| `db` | `pnpm test:db` |
| `db:aditivas` | `pnpm test:db:validar-aditivas` |
| `edge` | `pnpm test:edge:invitar-miembro && …solicitar-acceso && …crear-organizacion` |
| `ia` | `pnpm test:ia` |
| `tooling` | `node --test scripts/*.test.mjs` |
| `infra:config` | `pnpm infra:config` |
| `prototipo` | `pnpm prototipo:check && pnpm test:prototipo:inventario` |
| `matriz` | `pnpm matriz:check && pnpm test:matriz:pantalla` |

## Límites

- Es una selección **suficiente y determinista**, no “la mínima posible”: si
  tocás una página, corre toda la suite web (no sólo ese archivo).
- El **gate del PR** sigue corriendo todo en CI. Este plan es para iterar y para
  saber de antemano qué va a validar el PR.
- Los E2E con sesión (`permisos-por-empresa`, `stock-movimientos`) no entran acá:
  necesitan Supabase local (ver `docs/e2e-app.md`).
- Para agregar una suite: sumarla a `SUITES` y a `seleccionarSuites` **y** a la
  tabla de arriba. El test `tests-afectados.test.mjs` fija el contrato.
- **Tests de integración de pantalla** (varios campos + RPC + esperas, p. ej.
  `pages/productos/edit.test.tsx`): con la suite **shardeada** el timeout default
  de 5 s queda justo y da **falsos rojos** en PRs ajenos. Se sube el timeout del
  archivo (`vi.setConfig({ testTimeout })`) y las lecturas que dependen de datos
  async usan `findBy*`.

## Calidad determinista (`pnpm calidad`)
- `pnpm calidad` corre los checks **deterministas** del producto (gitleaks, semgrep, knip, jscpd,
  dependency-cruiser, syncpack, commitlint). `pnpm calidad:code` omite los que usan Docker.
- En CI corre el workflow **`quality`**. Al inicio es **no bloqueante** (`continue-on-error`) para
  observar el baseline; cuando el baseline esté limpio pasa a **check requerido** junto con `database`.
- El reporte queda en `reports/calidad.md` (artifact `calidad-reporte`).
- **Baseline**: `knip` corre con `ignoreExportsUsedInFile` (no marca exports usados en el mismo archivo); `syncpack` ignora los paquetes locales `@platform/*` (`workspace:*`); `semgrep` usa reglas **vendorizadas** en `.semgrep/registry/` (packs `p/typescript`/`p/react`; los secretos los cubre `gitleaks`): corre **offline** (sin registry). Si igual sale != 0 sin salida, se considera error de herramienta (saltado).
- **Baseline**: `knip` corre con `ignoreExportsUsedInFile`; `syncpack` ignora los paquetes locales
  `@platform/*` y `@types/node`; el **SAST** usa **oxlint** con reglas de seguridad (`no-eval`,
  `no-new-func`, `no-implied-eval`, `no-script-url`), sin depender de docker ni PyPI.

- `quality` es un **check REQUERIDO** (bloqueante) en los PRs a `dokploy` (baseline limpio).

- **gitleaks** corre con el **binario nativo** (el `-v` de Docker en runners containerizados puede
  escanear 0 bytes y dar falso verde). Docker queda como fallback local.
