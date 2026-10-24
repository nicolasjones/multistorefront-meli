# Contratos · Ventas comprobantes (MSF-159)

Todas las RPC: esquema `public`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración. La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Cada una exige `ventas` en `edicion` en la empresa del comprobante, salvo las de lectura (`lectura`). Los errores usan `42501` (permiso), `22023` (dato inválido), `P0001`/`40001` (conflicto o stock), con mensaje en castellano.

## F-VTA-05

- `crear_comprobante(p_tipo text, p_empresa_id uuid, p_cliente_id uuid, p_canal text, p_fecha date default current_date, p_valido_hasta date default null, p_forma_pago_id uuid default null, p_envio_id uuid default null) returns dominio.comprobantes_venta` — `p_tipo` ∈ (`factura`, `presupuesto`); factura nace `borrador`, presupuesto `pendiente`; asigna número correlativo.
- `guardar_comprobante(p_id uuid, p_cliente_id uuid, p_canal text, p_fecha date, p_valido_hasta date, p_forma_pago_id uuid, p_envio_id uuid, p_actualizado_en timestamptz) returns dominio.comprobantes_venta` — bloqueo optimista por `p_actualizado_en`; rechaza documentos cerrados; no cambia empresa ni tipo.
- `private.siguiente_numero_comprobante(p_empresa_id uuid, p_tipo text) returns integer` — correlativo transaccional (no ejecutable por `authenticated`).
- `obtener_comprobante(p_id uuid) returns jsonb` — cabecera + líneas + totales (lectura).

## F-VTA-06

- `guardar_lineas_comprobante(p_id uuid, p_lineas jsonb, p_actualizado_en timestamptz) returns dominio.comprobantes_venta` — `p_lineas`: arreglo de `{producto_id, cantidad, deposito_id, precio_manual?}`; recalcula precio con `private.precio_para` (firma a verificar en MSF-114), IVA y totales; `precio_manual` exige `puede_accion('ventas','editar_precio')`.
- `disponible_para_venta(p_producto_id uuid, p_deposito_id uuid) returns integer` — stock del depósito menos reservas (lectura; firma de las existencias por depósito a verificar en MSF-292).

## F-VTA-07

- `confirmar_comprobante(p_id uuid) returns dominio.comprobantes_venta` — solo `factura` en `borrador`; salida de stock por línea y depósito; reserva de líneas «A pedido»; todo o nada; idempotente.
- `private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text) returns boolean` — ajuste: factura distinta de `borrador` y `anulada`.
BREAKING: `private.comprobante_cuenta_como_facturado` deja de contar las facturas `borrador` (antes contaba toda factura no anulada); es interna del ranking de clientes (F-CLI-08) y el cambio estaba previsto en su migración.

## F-VTA-08

- `aceptar_presupuesto(p_id uuid) returns dominio.comprobantes_venta` — `pendiente` → `aceptado`; idempotente.
- `copiar_presupuesto(p_id uuid) returns dominio.comprobantes_venta` — nuevo `pendiente` con líneas copiadas.
- `listar_presupuestos(p_busqueda text default null, p_estado text default null, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10) returns table (...)` — columnas: id, numero, empresa_id, empresa, fecha, cliente, operador, valido_hasta, estado (con `vencido` derivado), total, puede_editar (`edicion` en la tienda de la fila), filas (conteo total). `p_estado` ∈ pendiente | aceptado | vencido | convertido; `pendiente` excluye a los vencidos. `aceptar_presupuesto` rechaza un vencido (`55000`); `copiar_presupuesto` recalcula precios salvo manual y falla con `22023` si un producto ya no está activo.
