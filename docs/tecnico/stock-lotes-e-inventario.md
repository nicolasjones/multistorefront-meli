---
owner: tecnico
sources:
  - supabase/migrations
---

# Stock · lotes e inventario (MSF-131)

Contratos, datos y operación de la épica MSF-131 (F-STK-10 · MSF-407 y F-STK-11 · MSF-415). El detalle de producto
(qué resuelve, para quién y límites) está en [Stock · lotes e inventario](../producto/stock-lotes-e-inventario.md).

!!! warning "Estado de la rama"
    La implementación vive en `epic/MSF-131-stock-stock-lotes-e-inventario`; a la fecha de esta página no está
    mergeada a `main`. Las migraciones, rutas y pruebas citadas existen en esa rama.

## Migraciones (aditivas)

| Migración | Contenido |
|-----------|-----------|
| `20261202100000_stock_lotes_tabla.sql` | `dominio.lotes_stock`, `movimientos_stock.lote_id` con FK compuesta, RLS de lectura y disparador de inmutabilidad |
| `20261202100100_stock_registrar_movimiento_lote.sql` | `registrar_movimiento_stock` gana `p_lote uuid default null` (firma de 7 → 8 parámetros) |
| `20261202100200_stock_registrar_lote.sql` | RPC `registrar_lote_stock` y helper `private.lote_stock_json` |
| `20261202100300_stock_lotes_lecturas.sql` | RPC `listar_lotes_stock` y `listar_movimientos_lote` |
| `20261202100400_stock_lotes_cursor_valido.sql` | Valida el cursor de `listar_lotes_stock` (`22023` en vez de `22P02`) |
| `20261202130000_stock_motivo_toma_inventario.sql` | Motivo de sistema «Toma de inventario» (aplica a `ajuste`) en organizaciones nuevas y existentes |
| `20261202130100_stock_confirmar_toma.sql` | RPC `confirmar_toma_inventario` |

Cada archivo trae su reversión en el encabezado. Nada se destruye en el mismo PR que lo crea.

## Modelo de datos

- `dominio.lotes_stock` (nueva, Principio VII): `id`, `organizacion_id`, `numero` (correlativo por organización),
  `proveedor` (texto libre ≤ 120, **no** referencia `dominio.proveedores`), `fecha`, `motivo_id`,
  `clave_idempotencia`, `actor_id`, `actor_nombre`, `creado_en`. Restricciones `unique (organizacion_id, numero)`,
  `unique (organizacion_id, clave_idempotencia)` y FK compuesta `(motivo_id, organizacion_id)`.
- `dominio.movimientos_stock.lote_id` (columna nueva, nullable): FK compuesta `(lote_id, organizacion_id)` e índice
  parcial. Se fija al insertar; el libro sigue inmutable y el stock negativo sigue bloqueado.
- La toma **no crea tablas ni entidad persistida**: produce movimientos `ajuste` en `dominio.movimientos_stock` con el
  motivo de sistema «Toma de inventario». Lee el stock del depósito por defecto en `dominio.existencias_deposito`.
- RLS en `lotes_stock`: `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y
  `private.nivel_seccion('stock') in ('lectura','edicion')`. Sin policies ni privilegios de escritura; `anon` sin
  privilegios. El disparador `lotes_stock_inmutable` rechaza `update`/`delete` con `42501` (deja pasar la cascada de
  la organización).

El DER completo del grafo afectado está en [Datos y DER](datos.md#stock-lotes-e-inventario-msf-131).

## RPC

Todas viven en `public`, con `revoke execute … from public, anon` y `grant execute … to authenticated`; exigen
`private.nivel_seccion('stock') = 'edicion'` para escribir (`42501` en caso contrario).

### `registrar_lote_stock`

```ts
registrar_lote_stock(
  p_lineas jsonb,                          // [{ producto: uuid, cantidad: integer > 0 }]
  p_motivo uuid,
  p_proveedor text default null,           // texto libre <= 120
  p_fecha date default current_date,       // no futura
  p_clave uuid default gen_random_uuid()   // idempotencia
) returns { lote: { id, numero, proveedor, fecha, motivo_id }, movimientos: [...] }
```

- 1 a 100 líneas, sin producto repetido; motivo activo que aplique a `entrada`; fecha no futura. Cualquier dato
  inválido responde `22023`.
- Registra el lote completo en una transacción: una entrada por línea mediante
  `registrar_movimiento_stock(..., p_lote := lote.id)`, o ninguna.
- Numeración e idempotencia: toma `pg_advisory_xact_lock` por organización **antes** de leer la clave y el máximo.
  Dos lotes simultáneos reciben números distintos y consecutivos; dos envíos con la misma clave devuelven el mismo
  lote sin mover stock. Un rechazo no consume número.
- Registra la actividad `stock.lote_registrado`.

### `listar_lotes_stock` y `listar_movimientos_lote`

```ts
listar_lotes_stock(p_limite integer default 50, p_cursor jsonb default null)
  returns { id, numero, fecha, proveedor, productos, unidades, creado_en }[]

listar_movimientos_lote(p_lote uuid)
  returns { movimiento_id, producto, sku, cantidad, saldo, creado_en }[]
```

- *security invoker*: la RLS de `lotes_stock` y `movimientos_stock` decide qué filas llegan.
- `listar_lotes_stock` ordena por `numero desc`, pagina por cursor `{"numero": n}` (tope 100) y devuelve el `id` que
  necesita el detalle. Un cursor mal formado responde `22023` («El cursor del historial de lotes no es válido»).
- `listar_movimientos_lote` usa `left join` con productos: sin acceso al producto muestra «Producto no disponible».

### Cambio de contrato: `registrar_movimiento_stock`

Gana `p_lote uuid default null` **al final** (de 7 a 8 parámetros). Es aditivo para los llamadores existentes
(`registrar_ingreso_mercaderia`, anulación, UI, `trasladar_stock`), pero la migración `20261202100100` hace `drop` de
la firma anterior y `create` de la nueva para no dejar dos sobrecargas ambiguas en PostgREST. El test
`stock_movimientos.test.sql` apunta a la firma de 8 parámetros. Si `p_lote` no pertenece a la organización, responde
`22023` («No encontramos ese lote»).

### `confirmar_toma_inventario`

```ts
confirmar_toma_inventario(p_items jsonb, p_fecha date default current_date)
  returns table (producto uuid, diferencia integer, saldo integer, movimiento_id uuid)
```

- `p_items = [{ producto: uuid, contado: integer >= 0 }]`, de 1 a 1000 ítems, sin producto repetido.
- Crea un ajuste por cada producto cuyo contado difiere del stock del **depósito por defecto**, con
  `registrar_movimiento_stock(..., 'ajuste', contado, motivo, ..., depósito)`. Los productos sin diferencia no
  generan movimiento, por eso repetir la confirmación no crea nada. Devuelve solo los ajustes creados.
- Todo o nada: cualquier error revierte todos los ajustes. Procesa por orden de producto y serializa por producto con
  el mismo `for update` que `registrar_movimiento_stock`.
- Errores: `42501` sin `edicion`; `22023` por ítems, contado, producto inexistente o de otra organización, repetidos,
  fecha futura, motivo desactivado o falta de depósito por defecto.
- El motivo se busca por nombre `toma de inventario` (sin distinguir mayúsculas) y debe estar activo.

## Actividad y eventos

- Lote: `stock.lote_registrado`.
- Toma: cada ajuste registra el evento de stock habitual (`stock.ajuste`) desde `registrar_movimiento_stock`.
- Los movimientos de un lote siguen emitiendo `stock.actualizado` a `public.cola_eventos` por la vía existente.

## Interfaz

- Pestañas en `PestanasStock` (`apps/web/src/pages/stock/PestanasStock.tsx`): «Carga en lote» (`/stock/lote`) y
  «Toma de inventario» (`/stock/toma-inventario`), además de las existentes.
- `apps/web/src/pages/stock/lote.tsx` + `components/stock/LoteStockForm.tsx` + `components/stock/HistorialLotes.tsx`:
  formulario, historial y detalle. Sin `edicion` se oculta el formulario y se muestra un aviso; el historial queda
  visible. La clave de idempotencia se renueva al editar el formulario y se conserva para reintentar el mismo envío.
  Si el catálogo de productos llega al tope de 500, el formulario avisa que puede faltar alguno.
- `apps/web/src/pages/stock/toma-inventario.tsx` + `apps/web/src/lib/tomaInventario.ts`: selector de categoría (una
  raíz incluye sus subcategorías), tabla con diferencia y resultado con los ajustes. Sin `edicion` se oculta
  «Confirmar». El máximo de 1000 productos se valida en cliente y en la RPC.
- Ninguna de las dos pantallas consulta ni filtra por empresa: el stock es único por organización (Principio VIII: no
  aplica) y la toma usa el depósito por defecto.

## Pruebas

- pgTAP: `supabase/tests/database/stock_lotes.test.sql`, `stock_lotes_concurrencia.test.sql` y
  `stock_toma_inventario.test.sql` (`pnpm test:db`).
- La concurrencia real de dos sesiones no se puede simular en un solo backend de pgTAP: el test de concurrencia
  verifica el contrato observable y que el bloqueo por organización se toma antes de leer la clave y el número.
- Vitest: `apps/web/src/pages/stock/lote.test.tsx` y `toma-inventario.test.tsx`.
- No hay recorrido E2E propio para esta épica.

## Reversión

En orden, en migraciones posteriores y exportando antes los datos:

1. `drop function public.registrar_lote_stock(jsonb, uuid, text, date, uuid)`,
   `private.lote_stock_json(uuid)`, `public.listar_lotes_stock(integer, jsonb)` y
   `public.listar_movimientos_lote(uuid)`.
2. `drop function public.confirmar_toma_inventario(jsonb, date)`.
3. Restaurar `registrar_movimiento_stock` a la firma de 7 parámetros de
   `20261023120200_stock_movimiento_deposito.sql`.
4. Restaurar `private.sembrar_motivos_movimiento` a la versión anterior y quitar «Toma de inventario» solo si no
   tiene movimientos; si ya tiene ajustes, se desactiva desde Motivos (el libro es de solo agregado).
5. Recién después: `alter table dominio.movimientos_stock drop column lote_id`, `drop table dominio.lotes_stock` y
   `drop function private.rechazar_cambio_lote_stock()`.

Los comandos exactos están en el encabezado de cada migración.
