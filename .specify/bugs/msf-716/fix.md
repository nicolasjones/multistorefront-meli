# Bug Fix: toma de inventario con categorías grandes — la URL del `in (…)` se pasa del límite

- **Slug**: msf-716
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`listarStockPorDepositoDe` serializaba hasta 1000 ids de producto en un único filtro `in.(…)` de la query
string del GET de PostgREST (39.189 bytes medidos con `URLSearchParams`; el proxy corta a ~8 KB y a partir de
~200 ids la petición ya no entra). Ahora parte los ids en lotes de 100, los pide de a olas de 4 y une el
resultado; si un lote falla, el error sale y no hay stock parcial. Además, `cargarFilasToma` pasó a usar
`count: 'exact'` para que el aviso de «más de 1000 productos» no dependa del tope de filas de la API (que
truncaba la categoría en silencio).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/depositos.ts` | modified | `listarStockPorDepositoDe` parte los ids en lotes (`LOTE_IDS_STOCK = 100`, ~4,1 KB por petición) y los pide de a olas (`MAXIMA_CONCURRENCIA_STOCK = 4`); deduplica ids; si un lote falla, propaga el error |
| `apps/web/src/lib/tomaInventario.ts` | modified | `cargarFilasToma` pide el total con `count: 'exact'` (PostgREST cuenta antes del `limit`) y avisa «La categoría tiene más de 1000 productos: elegí una subcategoría.» sin pedir el stock |
| `apps/web/src/lib/depositos.stockLotes.test.ts` | modified | Lotes, unión completa, lista vacía, ids repetidos, error de lote, largo de URL por lote y tope de peticiones simultáneas |
| `apps/web/src/lib/tomaInventario.carga.test.ts` | added | Camino real de carga: categoría de 1000 productos → 1000 filas con su stock, lotes con URL bajo el límite del proxy, categoría sin stock, categoría de más de 1000 (avisa y no pide stock) |
| `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` | added | Recorrido de pantalla: categoría con 250 productos → la tabla carga con las 250 filas y no aparece «No pudimos cargar los productos de esta categoría» |
| `docs/stock-toma-inventario.md` | modified | Sección «Categorías grandes (MSF-716)»: largos de URL medidos, lotes, olas y el aviso por `count` |
| `docs/e2e-app.md` | modified | Fila del recorrido E2E en la tabla de cobertura |

## Diff Highlights

```ts
export const LOTE_IDS_STOCK = 100
export const MAXIMA_CONCURRENCIA_STOCK = 4

const lotes: string[][] = []
for (let i = 0; i < ids.length; i += LOTE_IDS_STOCK) lotes.push(ids.slice(i, i + LOTE_IDS_STOCK))
const respuestas = await pedirEnOlas(lotes, async (lote) => { /* … .in('producto_id', lote) … */ })
```

```ts
const { data, error, count } = await supabaseClient
  .from('v_productos_listado')
  .select('id, nombre, sku', { count: 'exact' })
  // …
const total = count ?? productos.length
if (total > MAXIMO_PRODUCTOS_TOMA) throw new Error(`La categoría tiene más de ${MAXIMO_PRODUCTOS_TOMA} productos: elegí una subcategoría.`)
```

## Tests Added or Updated

- `apps/web/src/lib/depositos.stockLotes.test.ts::con 1000 ids parte en lotes acotados y devuelve la unión completa` — 10 lotes de 100 y las 1000 cifras.
- `apps/web/src/lib/depositos.stockLotes.test.ts::ninguna petición lleva una URL más larga que el límite del proxy` — cada filtro `in.(…)` ≤ 8000 bytes.
- `apps/web/src/lib/depositos.stockLotes.test.ts::el mismo conjunto de ids en una sola petición excedería el límite del proxy` — deja por escrito que 250 ids (9.939 bytes) y 1000 ids (39.189) no entran.
- `apps/web/src/lib/depositos.stockLotes.test.ts::no lanza más de MAXIMA_CONCURRENCIA_STOCK peticiones a la vez` — tope de 4 en vuelo.
- `apps/web/src/lib/depositos.stockLotes.test.ts::si un lote falla propaga el error (sin stock parcial)` — un lote roto aborta todo.
- `apps/web/src/lib/tomaInventario.carga.test.ts::una categoría de 1000 productos carga todas las filas con su stock en el sistema` — el escenario del bug, de punta a punta de la librería.
- `apps/web/src/lib/tomaInventario.carga.test.ts::el stock se pide en lotes cuya URL no excede el límite del proxy` — 10 lotes, cada URL ≤ 8000 bytes.
- `apps/web/src/lib/tomaInventario.carga.test.ts::una categoría con más de 1000 productos avisa y no pide el stock` — el total (`count`) delata el exceso aunque la API tops las filas en 1000.
- `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` — recorrido de pantalla con 250 productos (requiere el stack local; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/lib/depositos.stockLotes.test.ts src/lib/tomaInventario.carga.test.ts src/pages/stock/toma-inventario.test.tsx src/pages/stock/list.test.tsx src/pages/stock/depositos.test.tsx` → 5 archivos, 63 tests OK.
- `pnpm lint` → exit 0 (solo warnings preexistentes de `react(set-state-in-effect)` en otros archivos).
- `pnpm build` → exit 0 (`tsc -b && vite build`).
- `tsc --noEmit` del archivo E2E con `strict` → sin errores (la carpeta `e2e/` no entra en `tsconfig.app.json`).
- `pnpm --filter @platform/web exec playwright test --list` → el recorrido nuevo aparece (46 tests en 35 archivos).
- `GITHUB_BASE_REF=dokploy pnpm docs:check` → documentación OK; migraciones OK (419 archivos, 0 nuevos).
- `pnpm calidad` → oxlint (SAST), knip, jscpd, dependency-cruiser y syncpack OK; **gitleaks no se pudo correr** (no hay acceso al daemon de Docker en este entorno: `docker: permission denied … /var/run/docker.sock`). El diff se revisó a mano: no agrega secretos.

## Deviations from Assessment

1. **Concurrencia acotada (riesgo que el assessment nombró, ahora resuelto).** La primera versión pedía los 10 lotes en paralelo; queda en olas de `MAXIMA_CONCURRENCIA_STOCK = 4` (3 olas con 1000 productos). Razón: el fallo original era una URL contra el proxy; no hace falta una ráfaga para cargarlo.
2. **Se amplió el alcance a `apps/web/src/lib/tomaInventario.ts` (no estaba en «Files likely to change»).** Al dejar de fallar la carga, el aviso de «más de 1000 productos» quedó como código muerto: la API tops las filas en 1000 (`max_rows`), así que `.limit(1001)` nunca devuelve 1001 y la categoría se truncaba **en silencio** (la toma contaba 1000 de 1500 productos). Con `count: 'exact'` el aviso vuelve a dispararse. Es el mismo camino de código del bug y evita convertir un error visible en un inventario incompleto.
3. **El test de la pantalla quedó como E2E, no como Vitest.** `pages/stock/toma-inventario.test.tsx` mockea `cargarFilasToma`, así que no ejercita el reparto en lotes; el caso de 1000 productos se cubre en `lib/tomaInventario.carga.test.ts` (librería) y en el E2E (pantalla).

## Follow-ups

- El E2E `stock-toma-inventario-categorias.e2e.ts` no se ejecutó en este entorno (sin stack local de Supabase): se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e stock-toma-inventario-categorias`. Queda anotado en `docs/e2e-app.md`.
- `consultarCostos` (`apps/web/src/lib/productosListado.ts`) sigue usando un `in.(…)` sin repartir, pero está acotado a una página del listado (decenas de ids, ~2 KB de URL): no hay riesgo de URL larga. Si alguna vez el listado crece por página, se reparte con el mismo helper.
