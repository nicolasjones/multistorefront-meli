# Stock · Toma de inventario (F-STK-11, MSF-415)

Spec: `specs/20261024-120000-stock-lotes-e-inventario/` (épica MSF-131, FR-101…FR-106, SC-003). Permite contar
una categoría y corregir las diferencias con ajustes. La guía general de lotes e inventario (cierre) reúne esta
y la de «Carga en lote».

## Esquema (Principio VII)

No hay tablas nuevas: la toma **no es una entidad persistida**, produce movimientos de tipo `ajuste` en
`dominio.movimientos_stock` (dominio del producto) por la única vía de escritura de stock,
`registrar_movimiento_stock`. El motivo «Toma de inventario» es un dato de `dominio.motivos_movimiento`.

## Migraciones (aditivas)

| Migración | Contenido |
|-----------|-----------|
| `20261202130000_stock_motivo_toma_inventario.sql` | Motivo de sistema «Toma de inventario» (aplica a `ajuste`): siembra en organizaciones nuevas y relleno de las existentes |
| `20261202130100_stock_confirmar_toma.sql` | RPC `public.confirmar_toma_inventario` |

## Contrato: `public.confirmar_toma_inventario`

```
confirmar_toma_inventario(p_items jsonb, p_fecha date default current_date)
returns table (producto uuid, diferencia integer, saldo integer, movimiento_id uuid)
```

- `p_items`: `[{ "producto": uuid, "contado": entero >= 0 }]`, de 1 a 1000 ítems, sin producto repetido.
- Crea, en una sola transacción, **un ajuste por cada producto cuyo contado difiere** del stock del depósito
  por defecto (la toma opera sobre ese depósito; elegir depósito queda fuera de alcance). Los productos sin
  diferencia no generan movimiento, así que **repetir la misma confirmación no crea nada**.
- Devuelve solo los ajustes creados (diferencia aplicada y saldo total resultante).
- Todo o nada: ante cualquier error no queda ningún ajuste. Procesa por orden de producto y serializa por
  producto (mismo bloqueo que `registrar_movimiento_stock`), así que dos tomas simultáneas no se cruzan.
- Errores: `42501` si la sección Stock no está en `edicion`; `22023` por ítems, contado, producto (inexistente o
  de otra organización), repetidos, fecha futura o motivo desactivado.
- Permisos: `revoke ... from public, anon` y `grant ... to authenticated`.

## Interfaz

Pestaña «Toma de inventario» en Stock (`/stock/toma-inventario`, `pages/stock/toma-inventario.tsx`, lógica en
`lib/tomaInventario.ts`): se elige una categoría (una raíz incluye sus subcategorías), la tabla muestra
Producto/SKU, Stock en el sistema, Contado y Diferencia con signo. El campo vacío no se toca; un contado
inválido (negativo, decimal, texto) se marca y no se envía. «Confirmar» se oculta sin `edicion`. Tras confirmar se
listan los ajustes (producto, diferencia, saldo) y también aparecen en Movimientos. No consulta por empresa: el
stock es único por organización (Principio VIII: no aplica).

## Reversión

```
drop function public.confirmar_toma_inventario(jsonb, date);
-- restaurar private.sembrar_motivos_movimiento de 20261017140000_stock_existencias_y_movimientos.sql
-- delete from dominio.motivos_movimiento ... 'toma de inventario' (solo si no tiene movimientos: el libro es de solo agregado)
```

## Pruebas

- pgTAP: `supabase/tests/database/stock_toma_inventario.test.sql` (`pnpm test:db`).
- Vitest: `apps/web/src/pages/stock/toma-inventario.test.tsx`, `apps/web/src/lib/tomaInventario.carga.test.ts`
  (categoría de 1000 productos) y `apps/web/src/lib/depositos.stockLotes.test.ts` (lotes, largo de URL y olas).
- E2E: `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` (categoría con 250 productos; se omite sin
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — ver `docs/e2e-app.md`).

## Categorías grandes (MSF-716)

La toma admite hasta 1000 productos, pero el stock del depósito se pedía con un único filtro `in (…)` en la URL
del GET. Con ids de 36 caracteres (uuid), la URL medida con `URLSearchParams` da 4.089 bytes con 100 ids, 7.989 con
200, 9.939 con 250 y 39.189 con 1000: a partir de ~200 ids la petición pasa del límite típico de 8 KB del proxy y
la pantalla mostraba «No pudimos cargar los productos de esta categoría».

`listarStockPorDepositoDe` (`apps/web/src/lib/depositos.ts`) parte los ids en lotes de `LOTE_IDS_STOCK` (100, ~4,1 KB
por petición), los pide de a olas de `MAXIMA_CONCURRENCIA_STOCK` (4) y une el resultado. Si un lote falla, el error
sale y no se devuelven las olas siguientes: nunca hay stock parcial (rotularía diferencias falsas en la toma). Sin
cambios de base de datos. Lo aprovechan también Stock actual y su exportación.

Con el tope de filas de la API (1000), una categoría más grande se truncaba en silencio y la toma contaba solo una
parte: `cargarFilasToma` (`apps/web/src/lib/tomaInventario.ts`) pide el total con `count: 'exact'` (PostgREST cuenta
antes del `limit`) y avisa «La categoría tiene más de 1000 productos: elegí una subcategoría.» sin pedir el stock.
