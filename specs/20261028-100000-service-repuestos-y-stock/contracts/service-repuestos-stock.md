# Contratos: Service técnico · Service repuestos y stock (MSF-217)

Todas las RPC viven en `public`, son `security definer` con `search_path = ''`, llevan `revoke execute … from public, anon` y `grant execute … to authenticated`. La organización sale de la sesión. Errores: `22023` validación (campo en `hint`), `42501` sin permiso, `P0002` no existe / tienda inaccesible, `55000` reparación entregada o anulada, `23514` «No hay stock suficiente».

## F-SVC-10 · Descuento por depósito

```ts
agregar_item_reparacion(p_reparacion_id uuid, p_tipo text, p_descripcion text, p_producto_id uuid, p_cantidad numeric, p_precio numeric, p_deposito_id uuid default null) returns jsonb
```

BREAKING: la firma de 6 parámetros de MSF-199 desaparece (se reemplaza por la de 7, con `p_deposito_id` opcional). `apps/web/src/lib/reparacionItems.ts` se actualiza en el mismo cambio. Con `p_deposito_id` nulo se usa el depósito por defecto.

```ts
depositos_para_repuesto(p_producto_id uuid) returns jsonb  // [{ deposito_id, nombre, por_defecto, cantidad, reservado, disponible }]
```

Solo depósitos activos; gate `service_tecnico` en `lectura`/`edicion` (el Técnico no necesita Stock). Nueva.

`private.mover_stock_reparacion(...)` (interna, sin `grant`): aplica `private.aplicar_movimiento_deposito` e inserta en `dominio.movimientos_stock` con `origen = 'service'` y `reparacion_id`; la usan F-SVC-10, F-SVC-11 y F-SVC-12.

## F-SVC-11 · Devolución

```ts
quitar_item_reparacion(p_item_id uuid) returns jsonb
```

Misma firma de MSF-199; ahora devuelve el stock si el ítem estaba `descontado`.

```ts
anular_reparacion(p_id uuid, p_motivo text, p_consumidos uuid[] default '{}') returns jsonb
```

BREAKING: la firma `(uuid, text)` de MSF-182 desaparece (se reemplaza por la de 3 parámetros con `p_consumidos` opcional). `lib/reparaciones.ts` y `AnularDialog.tsx` se actualizan en el mismo cambio.

## F-SVC-12 · Pendiente de stock

```ts
agregar_item_reparacion(p_reparacion_id uuid, p_tipo text, p_descripcion text, p_producto_id uuid, p_cantidad numeric, p_precio numeric, p_deposito_id uuid default null, p_dejar_pendiente boolean default false) returns jsonb
```

BREAKING: la firma de 7 parámetros de F-SVC-10 se reemplaza por la de 8 (parámetro nuevo opcional). `listar_reparaciones(...)` conserva su firma; cada fila suma `pendientes_stock` (entero).

## Forma del documento (`obtener_reparacion` y RPC que lo devuelven)

Cada ítem suma `deposito_id`, `deposito_nombre` y `stock_estado` (`sin_movimiento` | `descontado` | `pendiente` | `consumido` | `devuelto`). Las claves anteriores no cambian.
