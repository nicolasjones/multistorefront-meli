# Stock · Carga en lote (F-STK-10, MSF-407)

Spec: `specs/20261024-120000-stock-lotes-e-inventario/` (épica MSF-131, historia US1). La persona del depósito
carga un remito completo de una vez: varios productos con su cantidad bajo un mismo **número de lote**. La toma
de inventario (F-STK-11) tiene su propia guía.

## Modelo (esquema `dominio`, Principio VII)

| Objeto | Para qué | Escritura |
|--------|----------|-----------|
| `dominio.lotes_stock` (nueva) | Cabecera del lote: `numero` correlativo por organización, `proveedor` (texto libre ≤ 120, **no** referencia `dominio.proveedores`), `fecha`, `motivo_id`, `clave_idempotencia`, actor y `creado_en`. `unique (organizacion_id, numero)` y `unique (organizacion_id, clave_idempotencia)`. | Solo la RPC `registrar_lote_stock`. Solo de agregado: un trigger rechaza `update`/`delete` (`42501`). |
| `dominio.movimientos_stock.lote_id` (columna nueva, nullable) | Vincula cada entrada con su lote; FK compuesta `(lote_id, organizacion_id)`. | Se fija al insertar. El libro sigue inmutable. |

RLS en `lotes_stock`: `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y
`private.nivel_seccion('stock') in ('lectura','edicion')`. Sin policies ni privilegios de escritura; `anon` sin
privilegios.

## RPC (todas en `public`, `revoke … from public, anon` + `grant execute … to authenticated`)

- `registrar_lote_stock(p_lineas jsonb, p_motivo uuid, p_proveedor text, p_fecha date, p_clave uuid)` →
  `{ lote: { id, numero, proveedor, fecha, motivo_id }, movimientos: [...] }`. Exige `edicion` en Stock (`42501`).
  `p_lineas = [{ "producto": uuid, "cantidad": entero > 0 }]`, 1 a 100 líneas, sin producto repetido; el motivo debe
  estar activo y aplicar a `entrada`; la fecha no puede ser futura (`22023` en cualquier dato inválido). Una entrada por
  línea mediante `registrar_movimiento_stock(..., p_lote := lote.id)`, **todo o nada** en una transacción.
- **Numeración e idempotencia:** la RPC toma un bloqueo de transacción por organización antes de leer la clave y el
  máximo número. Dos lotes simultáneos reciben números distintos y consecutivos; dos envíos con la misma clave crean un
  solo lote (el segundo devuelve el primero sin mover stock). Un rechazo no consume número.
- `listar_lotes_stock(p_limite, p_cursor)` y `listar_movimientos_lote(p_lote)`: lecturas `security invoker` (la RLS
  decide), más reciente primero, cursor `{"numero": n}`. `listar_lotes_stock` devuelve además `id` (para abrir el
  detalle), agregado al contrato de la spec.
- La actividad registra `stock.lote_registrado`.

## Cambio de contrato: `registrar_movimiento_stock` (alto riesgo)

Gana `p_lote uuid default null` **al final** (de 7 a 8 parámetros). Es aditivo para los llamadores existentes
(`registrar_ingreso_mercaderia`, anulación, UI, `trasladar_stock`: no pasan el parámetro nuevo), pero la migración
`20261202100100` reemplaza la firma anterior (`drop` + `create`, con `revoke`/`grant` de nuevo) para no dejar dos
sobrecargas ambiguas en PostgREST. El test `stock_movimientos.test.sql` apunta ahora a la firma de 8 parámetros.

## Pantalla

Pestaña «Carga en lote» (`/stock/lote`) dentro de Stock, protegida por la sección `stock`. Formulario: Proveedor
(opcional), Fecha (hoy por defecto), Motivo (solo motivos activos que aplican a entradas) y líneas Producto + Cantidad
con alta y baja; «Confirmar» muestra «Lote N registrado». La clave de idempotencia se genera en el cliente y se
conserva hasta que el envío tiene éxito: un reintento o un doble clic devuelve el mismo lote. Debajo, el historial de
lotes (número, fecha, proveedor, productos, unidades) y, al abrir un lote, sus movimientos. Con nivel `lectura` se ve
el historial pero no el formulario. La pantalla no consulta por empresa (el stock es único por organización).
La pestaña y el historial no están dibujados en el prototipo: se construyen con el sistema de diseño.

## Reversión

`drop function public.registrar_lote_stock(jsonb, uuid, text, date, uuid)`, `private.lote_stock_json(uuid)`,
`public.listar_lotes_stock(integer, jsonb)` y `public.listar_movimientos_lote(uuid)`; restaurar
`registrar_movimiento_stock` a la firma de 7 parámetros de `20261023120200`; luego, en una migración posterior (y
exportando antes los datos), `alter table dominio.movimientos_stock drop column lote_id`,
`drop table dominio.lotes_stock` y `drop function private.rechazar_cambio_lote_stock()`. Nada se destruye en el mismo
PR que lo crea.

## Verificación

- pgTAP: `supabase/tests/database/stock_lotes.test.sql` y `stock_lotes_concurrencia.test.sql` (`pnpm test:db`).
  La concurrencia real con dos sesiones no se puede simular en un solo backend de pgTAP: el segundo test verifica el
  contrato observable y que el bloqueo por organización se toma antes de leer la clave y el número.
- Vitest: `apps/web/src/pages/stock/lote.test.tsx` (`pnpm --filter @platform/web test -- lote`).
