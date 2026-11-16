# Contratos: Stock · Stock lotes e inventario

Todas las RPC viven en `public`, llevan `revoke execute ... from public, anon` y `grant execute ... to authenticated` explícito en su migración, y exigen `private.nivel_seccion('stock')` (lectura para listar, `edicion` para escribir).

## F-STK-10 · Movimientos en lote

```ts
registrar_lote_stock(
  p_lineas jsonb,            // [{ producto: uuid, cantidad: integer > 0 }], 1+ líneas, sin producto repetido
  p_motivo uuid,             // motivo activo que aplica a 'entrada'
  p_proveedor text default null, // texto libre, <= 120 caracteres
  p_fecha date default current_date, // no futura
  p_clave uuid default gen_random_uuid() // idempotencia: misma clave => mismo lote, sin mover stock otra vez
) returns { lote: { id, numero, proveedor, fecha, motivo_id }, movimientos: Movimiento[] }
```

Errores: `42501` sin nivel `edicion`; `22023` línea/fecha/motivo/proveedor inválidos o lote vacío. Todo o nada en una transacción; cada línea llama a `registrar_movimiento_stock(..., p_lote := lote.id)`.

```ts
listar_lotes_stock(p_limite integer default 50, p_cursor jsonb default null)
  returns { numero, fecha, proveedor, productos, unidades, creado_en }[]   // más reciente primero, keyset

listar_movimientos_lote(p_lote uuid)
  returns { movimiento_id, producto, sku, cantidad, saldo, creado_en }[]
```

```ts
registrar_movimiento_stock(
  p_producto uuid, p_tipo text, p_cantidad integer, p_motivo uuid,
  p_nota text default null, p_fecha date default current_date,
  p_deposito uuid default null,
  p_lote uuid default null   // NUEVO, al final
) returns dominio.movimientos_stock
```

BREAKING: cambia la firma de `registrar_movimiento_stock` (de 7 a 8 parámetros; el parámetro nuevo es opcional y va al final, por eso las llamadas existentes siguen válidas). Hay que `drop function` de la firma anterior en la migración, como ya se hizo en F-STK-14. Alto riesgo: revisión manual de todos los llamadores (`registrar_ingreso_mercaderia`, `trasladar_stock`, `descontar_reserva`, UI).

Datos: `dominio.lotes_stock(id, organizacion_id, numero, proveedor, fecha, motivo_id, clave_idempotencia, actor_id, actor_nombre, creado_en)`; `unique (organizacion_id, numero)`, `unique (organizacion_id, clave_idempotencia)`; `dominio.movimientos_stock.lote_id uuid null`.

## F-STK-11 · Toma de inventario

```ts
confirmar_toma_inventario(
  p_items jsonb,             // [{ producto: uuid, contado: integer >= 0 }], 1+ ítems, sin producto repetido
  p_fecha date default current_date
) returns { producto, diferencia, saldo, movimiento_id }[]  // solo los productos con diferencia != 0
```

Errores: `42501` sin nivel `edicion`; `22023` contado/producto/fecha inválidos. Todo o nada. Cada ajuste usa el motivo de sistema «Toma de inventario» y `registrar_movimiento_stock(..., 'ajuste', contado, ...)`.
