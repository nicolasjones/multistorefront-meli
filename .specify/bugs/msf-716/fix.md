# Bug Fix: toma de inventario con categorías grandes — la URL del `in (…)` se pasa del límite

- **Slug**: msf-716
- **Fixed**: 2026-11-01 (actualizado 2026-11-16 con la devolución del Revisor del PR #639)
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`listarStockPorDepositoDe` serializaba hasta 1000 ids de producto en un único filtro `in.(…)` de la query
string del GET de PostgREST (39.189 bytes medidos con `URLSearchParams`; el proxy corta a ~8 KB y a partir de
~200 ids la petición ya no entra). Ahora parte los ids en lotes de 100, los pide de a olas de 4 y une el
resultado; si un lote falla, el error sale y no hay stock parcial. Además, `cargarFilasToma` pasó a usar
`count: 'exact'` para que el aviso de «más de 1000 productos» no dependa del tope de filas de la API (que
truncaba la categoría en silencio).

Los ids de **categoría** viajan en la misma URL (`in ('categoria_id', …)`): también se reparten en lotes de 100
y los productos de los lotes se unen (sin repetir y ordenados por nombre, como en la consulta única); el total
del aviso es la suma del `count` de cada lote. Con una sola categoría —el caso habitual— la consulta es
exactamente la de antes: un lote, una petición.

Con la devolución del Revisor (PR #639) el reparto se extendió a `consultarCostos` (`productosListado.ts`), que
tenía el mismo patrón, y los tests vigilan ahora que cada lote de stock filtre por el depósito pedido.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/repartoIds.ts` | added | Reparto de ids en lotes para consultas cuyo filtro viaja en la URL del GET: `MAXIMO_IDS_POR_PETICION` (100, ~4,1 KB por petición), `MAXIMA_CONCURRENCIA_PETICIONES` (4), `enLotes` y `pedirEnOlas`. Vive aparte porque lo usan tres consultas (stock, categorías, costos) y no solo depósitos |
| `apps/web/src/lib/depositos.ts` | modified | `listarStockPorDepositoDe` parte los ids en lotes (`MAXIMO_IDS_POR_PETICION`, ~4,1 KB por petición) y los pide de a olas (`MAXIMA_CONCURRENCIA_PETICIONES`); deduplica ids; si un lote falla, propaga el error |
| `apps/web/src/lib/tomaInventario.ts` | modified | `cargarFilasToma` pide el total con `count: 'exact'` (PostgREST cuenta antes del `limit`) y avisa «La categoría tiene más de 1000 productos: elegí una subcategoría.» sin pedir el stock; además reparte también los ids de categoría (mismo tope de 100 por petición) y une los productos de los lotes |
| `apps/web/src/lib/productosListado.ts` | modified | `consultarCostos` reparte los ids con el mismo patrón (`enLotes` + `pedirEnOlas`): el `in.(…)` de `dominio.producto_costos` deja de viajar entero en la URL (MSF-716) |
| `apps/web/src/lib/depositos.stockLotes.test.ts` | modified | Lotes, unión completa, lista vacía, ids repetidos, error de lote, largo de URL por lote, tope de peticiones simultáneas y filtro por depósito de cada lote |
| `apps/web/src/lib/tomaInventario.carga.test.ts` | added | Camino real de carga: categoría de 1000 productos → 1000 filas con su stock, lotes con URL bajo el límite del proxy, categoría sin stock, categoría de más de 1000 (avisa y no pide stock), reparto del filtro por categoría (URL acotada, productos unidos y total por lote) y filtro por depósito de cada lote |
| `apps/web/src/lib/productosListado.test.ts` | modified | `consultarCostos` con 500 y 1000 ids: reparte en lotes con URL ≤ 8000 bytes y devuelve todos los costos |
| `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` | added | Recorrido de pantalla: categoría con 250 productos → la tabla carga con las 250 filas y no aparece «No pudimos cargar los productos de esta categoría» |
| `docs/stock-toma-inventario.md` | modified | Sección «Categorías grandes (MSF-716)»: largos de URL medidos, lotes, olas, el aviso por `count` y el filtro por depósito |
| `docs/catalogo.md` | modified | La columna «Costo» del listado se pide en lotes (MSF-716) |
| `docs/e2e-app.md` | modified | Fila del recorrido E2E en la tabla de cobertura |

## Diff Highlights

```ts
// apps/web/src/lib/repartoIds.ts
export const MAXIMO_IDS_POR_PETICION = 100
export const MAXIMA_CONCURRENCIA_PETICIONES = 4

export function enLotes<T>(ids: readonly T[], tamaño: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < ids.length; i += tamaño) lotes.push(ids.slice(i, i + tamaño))
  return lotes
}
```

```ts
const lotes = enLotes(ids, MAXIMO_IDS_POR_PETICION)
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

```ts
// Los ids de categoría también viajan en la URL: se reparten con el mismo tope.
const lotes = enLotes([...new Set(categoriaIds)], MAXIMO_IDS_POR_PETICION)
const respuestas = await pedirEnOlas(lotes, async (lote) => { /* … .in('categoria_id', lote) … */ })
const total = respuestas.reduce((suma, respuesta) => suma + respuesta.total, 0)
```

```ts
// Los costos del listado viajan por la misma URL: mismo reparto.
const lotes = enLotes([...new Set(productoIds)], MAXIMO_IDS_POR_PETICION)
const filas = await pedirEnOlas(lotes, async (lote) => { /* … .in('producto_id', lote) … */ })
```

## Tests Added or Updated

- `apps/web/src/lib/depositos.stockLotes.test.ts::con 1000 ids parte en lotes acotados y devuelve la unión completa` — 10 lotes de 100 y las 1000 cifras.
- `apps/web/src/lib/depositos.stockLotes.test.ts::ninguna petición lleva una URL más larga que el límite del proxy` — cada filtro `in.(…)` ≤ 8000 bytes.
- `apps/web/src/lib/depositos.stockLotes.test.ts::cada lote filtra el stock por el depósito pedido, no por otro` — el `eq('deposito_id', …)` de cada lote: sin él, el stock vendría de otros depósitos.
- `apps/web/src/lib/depositos.stockLotes.test.ts::el mismo conjunto de ids en una sola petición excedería el límite del proxy` — deja por escrito que 250 ids (9.939 bytes) y 1000 ids (39.189) no entran.
- `apps/web/src/lib/depositos.stockLotes.test.ts::no lanza más de MAXIMA_CONCURRENCIA_PETICIONES peticiones a la vez` — tope de 4 en vuelo.
- `apps/web/src/lib/depositos.stockLotes.test.ts::si un lote falla propaga el error (sin stock parcial)` — un lote roto aborta todo.
- `apps/web/src/lib/tomaInventario.carga.test.ts::una categoría de 1000 productos carga todas las filas con su stock en el sistema` — el escenario del bug, de punta a punta de la librería.
- `apps/web/src/lib/tomaInventario.carga.test.ts::el stock se pide en lotes cuya URL no excede el límite del proxy` — 10 lotes, cada URL ≤ 8000 bytes.
- `apps/web/src/lib/tomaInventario.carga.test.ts::el stock se pide filtrado por el depósito por defecto, no por otro` — cada lote filtra por `dep-1` y las cifras salen de ese depósito.
- `apps/web/src/lib/tomaInventario.carga.test.ts::una categoría con más de 1000 productos avisa y no pide el stock` — el total (`count`) delata el exceso aunque la API tops las filas en 1000.
- `apps/web/src/lib/tomaInventario.carga.test.ts::una sola categoría se consulta en una petición (no se parte al pedo)` — el caso habitual no cambia.
- `apps/web/src/lib/tomaInventario.carga.test.ts::muchas categorías se reparten en lotes cuya URL no excede el límite del proxy` — 250 categorías → 3 lotes, cada URL ≤ 8000 bytes.
- `apps/web/src/lib/tomaInventario.carga.test.ts::los productos de varias categorías se unen sin repetir y quedan ordenados por nombre` — la tabla no queda agrupada por categoría.
- `apps/web/src/lib/tomaInventario.carga.test.ts::el total de la categoría suma los lotes y avisa si supera el máximo` — el aviso también funciona con el filtro repartido.
- `apps/web/src/lib/productosListado.test.ts::con 500 ids reparte en lotes con URL bajo el límite y devuelve todos los costos` — 5 lotes, cada URL ≤ 8000 bytes.
- `apps/web/src/lib/productosListado.test.ts::con 1000 ids reparte en lotes con URL bajo el límite y devuelve todos los costos` — 10 lotes, cada URL ≤ 8000 bytes.
- `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` — recorrido de pantalla con 250 productos (requiere el stack local; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

## Local Verification

Última corrida (después de la devolución del Revisor del PR #639, sobre el HEAD de la rama):

- `pnpm --filter @platform/web exec vitest run src/lib/depositos.stockLotes.test.ts src/lib/tomaInventario.carga.test.ts src/lib/productosListado.test.ts src/pages/stock/toma-inventario.test.tsx src/pages/stock/list.test.tsx src/pages/stock/depositos.test.tsx src/lib/categorias.test.ts` → 7 archivos, 117 tests OK.
- Mutaciones a propósito (para comprobar que los tests vigilan la regla): sin el `.eq('deposito_id', …)` fallan 3 tests; con el depósito cambiado fallan 4; con `consultarCostos` sin repartir fallan los 2 tests de 500 y 1000 ids. Se revirtieron todas.
- `pnpm lint` → exit 0 (solo warnings preexistentes de `react(set-state-in-effect)` en otros archivos).
- `pnpm build` → exit 0 (`tsc -b && vite build`).
- `GITHUB_BASE_REF=dokploy pnpm docs:check` → documentación OK (13 archivos contra `origin/dokploy`); migraciones OK (429 archivos, 0 nuevos).
- `pnpm calidad` → oxlint (SAST), knip (código muerto), jscpd (duplicación), dependency-cruiser (arquitectura) y syncpack OK; **gitleaks no se pudo correr** (no hay acceso al daemon de Docker en este entorno: `docker: permission denied … /var/run/docker.sock`). El diff se revisó a mano: no agrega secretos.

Corrida anterior (arranque de la historia):

- `pnpm --filter @platform/web exec vitest run src/lib/depositos.stockLotes.test.ts src/lib/tomaInventario.carga.test.ts src/pages/stock/toma-inventario.test.tsx src/pages/stock/list.test.tsx src/pages/stock/depositos.test.tsx` → 5 archivos, 63 tests OK.
- `tsc --noEmit` del archivo E2E con `strict` → sin errores (la carpeta `e2e/` no entra en `tsconfig.app.json`).
- `pnpm --filter @platform/web exec playwright test --list` → el recorrido nuevo aparece (46 tests en 35 archivos).

## Devolución del Revisor (PR #639, SHA revisado c8f0bffe3d)

| Hallazgo | Qué se hizo |
|----------|--------------|
| `apps/web/src/lib/depositos.ts:227` — el `.eq('deposito_id', depositoId)` del stock por lotes no lo vigilaba ningún test (los mocks de `eq` ignoraban los argumentos y devolvían siempre filas con `deposito_id: 'dep'`): si el reparto perdiera o cambiara ese filtro, la toma usaría cifras de otros depósitos | Cerrado con código y test. Los dos mocks ahora capturan el valor del filtro (`depositos.stockLotes.test.ts` y `tomaInventario.carga.test.ts`) y el stock que devuelven es el del depósito filtrado. Dos tests nuevos lo vigilan: «cada lote filtra el stock por el depósito pedido, no por otro» (el `eq` de cada lote es el pedido y la fila devuelta trae ese depósito) y «el stock se pide filtrado por el depósito por defecto, no por otro» (las cifras del sistema salen del depósito pedido: si el filtro se perdiera, saldrían de otro). Comprobado que fallan si se saca el filtro o se cambia el depósito |
| `apps/web/src/lib/productosListado.ts:125` — el alcance aprobado incluye trocear `consultarCostos` con el mismo patrón y cubrirlo con 500/1000 ids; el diff lo dejaba con un único `in.(…)` y solo lo pasaba a Follow-up sin dueño | Cerrado con código y test. `consultarCostos` reparte los ids con `enLotes` + `pedirEnOlas` (mismo tope de 100 por petición) y dos tests nuevos (`productosListado.test.ts`) comprueban con 500 y 1000 ids que sale en 5 y 10 lotes, cada URL ≤ 8000 bytes, y que vuelve el costo de todos los productos. El Follow-up que lo dejaba sin hacer sale de este informe |

## Devolución del Revisor (PR #565, SHA revisado 47ddfbbe)

| Hallazgo | Qué se hizo |
|----------|--------------|
| «No corrí tests ni `pnpm calidad`» (falta de evidencia local) | Corrida local completa y registrada arriba: 92 tests del área, `pnpm lint` exit 0, `pnpm build` exit 0, `pnpm docs:check` OK y `pnpm calidad` con los cinco chequeos en verde (gitleaks sigue sin poder correrse por falta del daemon de Docker; queda para el CI). |
| Nota de código: `tomaInventario.ts:72` — el `in('categoria_id', …)` también va por la URL | Cerrada con código y test: los ids de categoría se reparten con el mismo tope de 100 por petición (`apps/web/src/lib/tomaInventario.ts:73-88`), los productos de los lotes se unen sin repetir y ordenados por nombre, y el total del aviso es la suma del `count` de cada lote. Con una sola categoría (el caso habitual) la consulta es la de antes. |
| «`.specify/bugs/msf-716/*` no pasa nada con que estén en el PR» | Sin cambios: son los artefactos que pide el flujo de bugs. |
| Tracker: «la confirmación de la toma y los ajustes» / «filtros y movimientos» | Sin cambios: no forman parte de esta historia (el Revisor los marca como ⏭️). |

## Deviations from Assessment

1. **Concurrencia acotada (riesgo que el assessment nombró, ahora resuelto).** La primera versión pedía los 10 lotes en paralelo; queda en olas de `MAXIMA_CONCURRENCIA_PETICIONES = 4` (3 olas con 1000 productos). Razón: el fallo original era una URL contra el proxy; no hace falta una ráfaga para cargarlo.
2. **Se amplió el alcance a `apps/web/src/lib/tomaInventario.ts` (no estaba en «Files likely to change»).** Al dejar de fallar la carga, el aviso de «más de 1000 productos» quedó como código muerto: la API tops las filas en 1000 (`max_rows`), así que `.limit(1001)` nunca devuelve 1001 y la categoría se truncaba **en silencio** (la toma contaba 1000 de 1500 productos). Con `count: 'exact'` el aviso vuelve a dispararse. Es el mismo camino de código del bug y evita convertir un error visible en un inventario incompleto.
3. **El test de la pantalla quedó como E2E, no como Vitest.** `pages/stock/toma-inventario.test.tsx` mockea `cargarFilasToma`, así que no ejercita el reparto en lotes; el caso de 1000 productos se cubre en `lib/tomaInventario.carga.test.ts` (librería) y en el E2E (pantalla).
4. **También se repartió el filtro por categoría** (nota del Revisor en la devolución del PR #565). El `in ('categoria_id', …)` viaja por la misma URL GET que el de producto: hoy lleva pocos ids (una raíz y sus subcategorías directas), pero con un árbol de categorías grande volvería a romper la carga por el mismo motivo. El reparto no cambia el caso habitual (una sola categoría → una sola petición) y suma el `count` de cada lote para que el aviso de «más de 1000 productos» siga siendo exacto.
5. **El reparto se aplica también a `consultarCostos` y el helper pasó a su propio módulo** (`apps/web/src/lib/repartoIds.ts`, devolución del PR #639). El assessment lo nombraba como opción («helper genérico de lotes (`enLotes`) reutilizable por `consultarCostos`»): con un segundo consumidor, el helper dejó de ser de depósitos y su nombre (`LOTE_IDS_STOCK`) ya no describía lo que hace. `MAXIMO_IDS_POR_PETICION` y `MAXIMA_CONCURRENCIA_PETICIONES` son los mismos valores (100 y 4): solo cambia el nombre y el módulo donde viven. El módulo nuevo no importa nada, así que el listado de productos no arrastra el cliente de Supabase.

## Follow-ups

- El E2E `stock-toma-inventario-categorias.e2e.ts` no se ejecutó en este entorno (sin stack local de Supabase): se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e stock-toma-inventario-categorias`. Queda anotado en `docs/e2e-app.md`.
- La revisión de secretos (gitleaks) no se pudo correr en este entorno (sin daemon de Docker): la corre en el job `quality` del CI.
