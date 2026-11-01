# Contrato: variantes (F-CAT-15)

Esquema `dominio` para tablas, `public` para RPC y vistas (Principio VII). Todas `grant execute … to authenticated` y `revoke … from public, anon`.

## `guardar_variantes_producto(p_producto, p_actualizado_en, p_variantes)`

```ts
guardar_variantes_producto(
  p_producto: uuid,
  p_actualizado_en: timestamptz,   // updated_at del producto leído al abrir la ficha (bloqueo optimista)
  p_variantes: jsonb               // [{ id?: uuid, nombre: text, codigo: text, codigo_barras?: text, activa: boolean, stock?: int }]
): jsonb                           // { variantes: [{ id, nombre, codigo, codigo_barras, activa, orden, stock }] }
```

- `security invoker` (rige RLS); exige `edicion` en `productos`. Si una fila trae `stock`, exige además `edicion` en `stock` y registra un `ajuste` (motivo «Conteo de inventario», depósito por defecto) solo si difiere del actual.
- Reemplazo completo e idempotente: las filas con `id` se actualizan, las sin `id` se crean; el orden es la posición en el arreglo. Las variantes existentes ausentes del arreglo **no se borran** (no hay DELETE): se informan por error `22023` (hay que enviarlas, desactivadas si corresponde).
- Errores: `40001` (producto cambió), `P0002` (producto inexistente/otra organización), `23505` (código o código de barras repetido, con el valor en el mensaje), `22023` (formato EAN-13, nombre vacío, primera variante sobre producto con stock > 0), `42501` (sin permiso).
- Evento: `producto.variantes_editadas` en `registro_actividad`, sin costo, solo con cambio real.

## `registrar_movimiento_stock(…, p_variante)`

```ts
registrar_movimiento_stock(
  p_producto: uuid, p_tipo: text, p_cantidad: int, p_motivo: uuid, p_nota: text,
  p_fecha: date, p_deposito: uuid, p_lote: uuid,
  p_variante: uuid default null
): jsonb
```

BREAKING: se suma `p_variante` a la firma vigente de 8 parámetros (`20261202100100`); se reemplaza la función (la firma de 8 se elimina y se recrea con 9, `default null` para los llamadores existentes) y se vuelve a conceder `execute` a `authenticated`. En un producto con variantes `p_variante` es obligatorio (`22023`); sin variantes debe ser nulo.

## Vistas de lectura

```ts
v_producto_variantes: { id, producto_id, nombre, codigo, codigo_barras, activa, orden, stock /* null sin acceso a stock */ }
```

`security_invoker = true`; `revoke … from public, anon`; `grant select … to authenticated`. Sin precio ni costo: el precio se resuelve por `producto_id` con Precios (`private.precio_para`, sin cambios).

## Funciones `private` (solo cambia el cuerpo)

`private.disponibilidad_producto(uuid)`, `private.productos_con_stock()`, `private.disponible_publico(uuid)`: con variantes, disponible = suma de variantes activas. Firmas y grants sin cambios.
