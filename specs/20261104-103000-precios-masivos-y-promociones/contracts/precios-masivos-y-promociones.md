# Contratos · Precios masivos y promociones (MSF-363)

Todo nuevo y aditivo: **no hay BREAKING**. RPC en `public` (**`security definer`** con `set search_path = ''` y validación de permisos adentro; `revoke … from public, anon`, `grant execute … to authenticated`). La vista `promociones_precio_estado` es `security_invoker`. Permisos de promociones por tienda (`private.nivel_productos_en_empresa`). Los nombres finales de parámetros se fijan en la migración; esta es la firma de revisión.

## F-PRE-10

```ts
previsualizar_actualizacion_precios(p_modo: 'porcentaje' | 'planilla', p_parametros: jsonb): jsonb
// porcentaje: { cambia: 'costo' | 'precio_lista' | 'ambos', alcance: 'todos' | categoria_id, porcentaje: number }
// planilla:   { filas: [{ fila: number, sku: string, costo?: number, precio_lista?: number }] }
// → { afectados, sin_cambio, con_error, filas: [{ fila, producto_id, sku, nombre, lista_antes, lista_despues, costo_antes?, costo_despues?, error? }] }
// Solo lectura. costo_* solo con rentabilidad. 42501 si no hay productos=edicion o si el cambio toca costos sin rentabilidad=edicion (igual que aplicar).

aplicar_actualizacion_precios(p_modo, p_parametros: jsonb, p_clave: uuid): jsonb
// Atómica e idempotente por p_clave. Errores: 42501 sin permiso, 40001 conflicto por updated_at, 22023 datos inválidos (con filas).
// → { lote_id, aplicados }
```

## F-PRE-11

```ts
guardar_promocion_precio(p_id: uuid | null, p_empresa: uuid, p_producto: uuid, p_precio: numeric, p_desde: timestamptz, p_hasta: timestamptz, p_actualizado: timestamptz | null): jsonb
anular_promocion_precio(p_id: uuid, p_actualizado: timestamptz): jsonb
// Errores: 42501 sin permiso (productos=edicion en la tienda de la promoción), 23P01 solape, 22023 datos inválidos, 40001 conflicto.

private.precio_vigente_empresa(p_producto: uuid, p_empresa: uuid, p_ahora: timestamptz): { precio, precio_anterior }
public.promociones_precio_estado  // vista security_invoker: estado ∈ programada | vigente | vencida | anulada
```

## Contrato público de la tienda (aditivo, `publico`)

```ts
publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina): jsonb
// cada producto suma precio_anterior: number | null (null sin promoción vigente); precio ya incluye la promoción.
```
