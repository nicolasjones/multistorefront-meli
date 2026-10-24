# Contratos · Ventas motos (MSF-145)

Todas las RPC: esquema `public`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración. La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Escritura: exigen `ventas` en `edicion` en la empresa del comprobante; lectura: `lectura`. Errores: `42501` (permiso), `22023` (dato inválido), `23505` (duplicado), `40001` (conflicto), con mensaje en castellano. Todo lo de abajo es **nuevo** (no cambia ninguna firma existente).

## F-VTA-24

- `registrar_envio_moto(p_comprobante_id uuid, p_guia text default null, p_costo_envio numeric default 0, p_abono numeric default 0, p_enviado boolean default false) returns dominio.envios_moto` — solo factura no anulada con forma de envío `moto`; un envío por comprobante.
- `actualizar_envio_moto(p_id uuid, p_guia text, p_costo_envio numeric, p_abono numeric, p_enviado boolean, p_actualizado_en timestamptz) returns dominio.envios_moto` — bloqueo optimista; costo y abono inmutables si está rendido.
- `comprobantes_para_envio_moto(p_empresa_id uuid default null, p_busqueda text default null) returns table (id uuid, numero text, empresa_id uuid, empresa text, fecha date, cliente text)` — facturas elegibles sin envío registrado.
- `listar_envios_moto(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 25) returns table (id uuid, comprobante_id uuid, comprobante_numero text, empresa_id uuid, empresa text, fecha date, cliente text, guia text, costo_envio numeric, abono numeric, enviado boolean, rendido boolean, actualizado_en timestamptz, puede_editar boolean, filas bigint)` — más reciente primero.

## F-VTA-25

- `rendir_envios_moto(p_ids uuid[], p_rendido boolean default true) returns jsonb` — `{ "cantidad": n, "total_abono": x, "total_costo": y }`; todo o nada, idempotente; `p_rendido = false` revierte.
- `resumen_motos_sin_rendir(p_empresa_id uuid default null) returns table (monto numeric, entregas integer)` — suma de `abono` de los envíos sin rendir con `abono > 0` y su cantidad.
