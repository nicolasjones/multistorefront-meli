# Contratos · Ventas mejoras (MSF-193)

Todas las RPC: esquema `public`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración (las de escritura `security definer`; la de lectura de producto también, para no exigir la sección `productos`). La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Errores: `42501` (permiso), `22023` (dato inválido), `55000` (estado no válido), con mensaje en castellano. Los nombres de `dominio.cobros_comprobante` y `public.registrar_cobro` provienen de MSF-195 y se verifican contra `main` al implementar.

## F-VTA-31 · Venta de mostrador con lector de código de barras

- `buscar_producto_por_codigo_barras(p_codigo_barras text) returns dominio.productos` — `security definer`, exige `ventas` en `edicion` en la empresa activa; valida EAN-13 (`^[0-9]{13}$`); resuelve por el índice único `productos_org_codigo_barras_uidx` dentro de la organización y solo `activo`; sin coincidencia no devuelve filas (el cliente muestra «Producto no encontrado»). No expone costo ni datos de otra organización.

## F-VTA-32 · Precios especiales por cliente

- `public.clientes.descuento numeric` (nueva columna aditiva): porcentaje 0..100, 2 decimales, `null` = sin descuento. Editable solo por Administrador; se lee en `guardar_lineas_comprobante` (servidor) para aplicarlo sobre el neto de escala antes del IVA.
- `guardar_lineas_comprobante(p_id uuid, p_lineas jsonb, p_actualizado_en timestamptz) returns dominio.comprobantes_venta` — **misma firma**; se modifica el cuerpo (sin `BREAKING`): `v_unitario := round(v_precio.neto * (1 - coalesce(descuento, 0) / 100), 2)` salvo `precio_manual`. El descuento sale de `public.clientes` del comprobante, nunca del payload.
BREAKING: ninguno — no cambia la firma ni el contrato de retorno de `guardar_lineas_comprobante`; solo cambia el valor del precio calculado para clientes con descuento.

## F-VTA-33 · Cierre de caja diario

- `cerrar_caja(p_empresa_id uuid, p_fecha date) returns dominio.cierres_caja` — Administrador; resume los cobros del día (`dominio.cobros_comprobante` de esa empresa con `registrado_en::date = p_fecha`) por `forma_pago_id` y `cuenta_cobro_id` (nulable = sin cuenta), inserta cierre + detalle, marca `cerrada`; idempotente por (organización, empresa, fecha) — un segundo cierre del mismo día devuelve el existente o falla con `55000`. Evento `caja.cerrada`.
- `reabrir_caja(p_cierre_id uuid) returns dominio.cierres_caja` — Administrador; `cerrada` → `reabierta`, registra `reabierto_por`/`reabierto_en`; idempotente. Evento `caja.reabierta`.
- `listar_cierres_caja(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10) returns table (...)` — lectura (`ventas` ≥ `lectura`): id, empresa_id, empresa, fecha, estado, total, cerrado_por, cerrado_en, detalle (jsonb por forma de pago y cuenta), filas.
- `private.caja_cerrada(p_empresa_id uuid, p_fecha date) returns boolean` — `true` si existe un cierre `cerrada` para esa empresa y fecha (no ejecutable por `authenticated`).
- Trigger `before insert or update` sobre `dominio.cobros_comprobante`: rechaza con `55000` («La caja de ese día está cerrada; reabrila para registrar o modificar cobros») cuando `private.caja_cerrada(empresa_id, registrado_en::date)`. No altera columnas ni políticas de MSF-195.
