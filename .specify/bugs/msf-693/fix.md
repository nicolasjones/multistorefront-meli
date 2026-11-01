# Bug Fix: Ingreso de mercadería trunca a 500 productos y proveedores sin aviso

- **Slug**: msf-693
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Los selectores de «Nuevo ingreso» (Proveedor y Producto) y los filtros Proveedor/Producto del
historial buscaban solo en el cliente sobre los primeros 500 registros ordenados por nombre: con un
catálogo mayor, lo que quedaba después del 500.º no se podía elegir ni filtrar y la pantalla no
avisaba del corte. Ahora la búsqueda se resuelve en el servidor (RLS del llamador, sin migración) y,
cuando el catálogo no entra, la pantalla lo avisa.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/hooks/useBuscadorCatalogo.ts` | added | Búsqueda por texto en el servidor para `dominio.productos` y `dominio.proveedores`: espera de 250 ms, «última petición gana», tope de 500 con una fila de más para detectar el corte (`truncado`). El texto se sanea antes de armar el filtro `or` (mismo criterio que `lib/productosListado.ts`). |
| `apps/web/src/hooks/useBuscadorCatalogo.test.tsx` | added | Filtro, aviso de truncado, carga diferida, carrera de respuestas y error de consulta. |
| `apps/web/src/components/stock/IngresoMercaderiaForm.tsx` | modified | Proveedor y Producto buscan en el servidor; se avisa si el catálogo se cortó; lo elegido se conserva aunque cambie la búsqueda. |
| `apps/web/src/components/stock/IngresoMercaderiaForm.test.tsx` | modified | Truncado, búsqueda en servidor, aviso de truncado del proveedor, selección conservada y error de búsqueda. |
| `apps/web/src/components/stock/HistorialIngresos.tsx` | modified | Los filtros Proveedor y Producto del historial buscan en el servidor y avisan si el catálogo se cortó. |
| `apps/web/src/components/stock/HistorialIngresos.test.tsx` | modified | Búsqueda del filtro de proveedor en el servidor y aviso de truncado del filtro de producto. |
| `docs/ingreso-de-mercaderia.md` | modified | Sección «Selectores de proveedor y producto (MSF-693)»: búsqueda en servidor, aviso de truncado, conservación de lo elegido, errores y por qué no hay migración. |

## Diff Highlights

```ts
// apps/web/src/hooks/useBuscadorCatalogo.ts — el corte se detecta pidiendo una fila de más
respuesta = await consulta
  .order(orden, { ascending: true })
  .order('id', { ascending: true })
  .limit(MAXIMO_OPCIONES_CATALOGO + 1)
  .returns<T[]>()
...
setTruncado(filas.length > MAXIMO_OPCIONES_CATALOGO)
setOpciones(filas.slice(0, MAXIMO_OPCIONES_CATALOGO))
```

```tsx
// apps/web/src/components/stock/IngresoMercaderiaForm.tsx — el aviso no lo tapa lo elegido
const ayudas = [
  producto && producto.proveedor_id === proveedorId ? 'Proveedor del producto: coincide' : null,
  productos.truncado ? avisoCatalogoTruncado('productos') : null,
].filter(Boolean)
```

## Tests Added or Updated

- `apps/web/src/hooks/useBuscadorCatalogo.test.tsx::filtroBusquedaCatalogo` — el texto tipeado se
  busca como texto: se quitan los caracteres que alterarían el filtro de PostgREST y se escapan
  los comodines de LIKE.
- `apps/web/src/hooks/useBuscadorCatalogo.test.tsx::useBuscadorCatalogo` — no consulta hasta que se
  habilita, avisa cuando el catálogo se cortó (y no avisa cuando entra entero), busca en el
  servidor por las columnas indicadas, descarta la respuesta de una búsqueda anterior y marca el
  error de consulta.
- `apps/web/src/components/stock/IngresoMercaderiaForm.test.tsx` — con 501 productos se muestra el
  aviso y sigue visible después de elegir; escribir un texto dispara la consulta con `ilike` y
  deja elegir un producto fuera de los primeros 500; el proveedor también busca en el servidor y
  avisa; el producto elegido se conserva cuando cambia la búsqueda; el error de búsqueda no rompe
  el formulario.
- `apps/web/src/components/stock/HistorialIngresos.test.tsx` — el filtro de proveedor busca en el
  servidor y el filtro de producto avisa cuando el catálogo se cortó.

## Local Verification

- `pnpm --filter @platform/web test src/hooks/useBuscadorCatalogo.test.tsx src/components/stock/IngresoMercaderiaForm.test.tsx src/components/stock/HistorialIngresos.test.tsx` → 28/28 en verde.
- `pnpm lint` → sin errores (solo los avisos previos de `set-state-in-effect`).
- `pnpm build` (incluye `tsc -b`) → OK.
- `pnpm docs:check` → OK.

## Deviations from Assessment

- **Filtro `or` con `%` y saneado, no con `*` y valor entre comillas.** El assessment proponía
  armar el patrón de `ilike` con el comodín `*` de PostgREST. Se sigue el patrón ya usado y
  probado contra el servidor en `lib/productosListado.ts` y `lib/stock.ts` (`%` + saneado de
  `,()"\*` y escapado de `%`/`_`): el mismo resultado, sin inventar una variante de filtrado.
- **`LoteStockForm` (Stock → Carga en lote) no se toca.** El assessment lo citaba como «mismo
  patrón», pero esa pantalla **ya avisa** del corte («Se muestran los primeros 500 productos
  activos por nombre; puede que falten algunos en la lista.»), o sea cumple el mínimo del
  ticket; la búsqueda en servidor de esa pantalla es otra funcionalidad (F-STK-10) y queda fuera de
  este bug.
- **Se cubren también los filtros del historial.** El assessment los mencionaba como alcance
  opcional; están en la misma pantalla de «Ingreso de mercadería» y tenían el mismo truncado
  silencioso, así que van con el arreglo.

## Follow-ups

- El patrón compartido (`useBuscadorCatalogo`) queda disponible para los otros selectores con
  tope de la plataforma (`pages/stock/NuevoMovimientoDialog.tsx`, filtro de productos de
  `pages/stock/movimientos.tsx` y faltantes). No se tocan acá: son de otras pantallas y no tienen el
  truncado silencioso del ticket.
