# Contratos · Ventas motos (MSF-145)

Todas las RPC: esquema `public`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración. La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Lectura: `ventas` en `lectura` o `edicion` en la empresa. Registro/edición/marcar Enviado: `ventas` en `edicion` **y** rol efectivo `operador` o `administrador` en la empresa (o superadmin). Rendición: solo `administrador` (o superadmin). Errores: `42501` (permiso), `22023` (dato inválido), `23505` (duplicado), `40001` (conflicto), `55000` (envío rendido, de solo lectura), con mensaje en castellano. Todo lo de abajo es **nuevo** (no cambia ninguna firma existente).

## F-VTA-24

- `registrar_envio_moto(p_comprobante_id uuid, p_mensajero text, p_guia text default null, p_costo_envio numeric default 0, p_abono numeric default 0, p_enviado boolean default false) returns dominio.envios_moto` — solo factura (no presupuesto, no anulada) con forma de envío `moto` de la misma empresa; un envío por comprobante; `mensajero` no vacío; `costo_envio`/`abono >= 0`. Nunca escribe `rendido` ni `rendido_en`.
- `actualizar_envio_moto(p_id uuid, p_mensajero text, p_guia text, p_costo_envio numeric, p_abono numeric, p_enviado boolean, p_actualizado_en timestamptz) returns dominio.envios_moto` — bloqueo optimista (`40001`); rechaza un envío rendido (`55000`); nunca escribe `rendido` ni `rendido_en`.
- `comprobantes_para_envio_moto(p_empresa_id uuid default null, p_busqueda text default null) returns table (id uuid, numero text, empresa_id uuid, empresa text, fecha date, cliente text)` — facturas elegibles (forma de envío `moto`, misma empresa) sin envío registrado y de empresas accesibles.
- `listar_envios_moto(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 25) returns table (id uuid, comprobante_id uuid, comprobante_numero text, empresa_id uuid, empresa text, fecha date, cliente text, mensajero text, guia text, costo_envio numeric, abono numeric, enviado boolean, rendido boolean, rendido_en timestamptz, actualizado_en timestamptz, puede_editar boolean, puede_rendir boolean, filas bigint)` — más reciente primero; filtra por empresas accesibles y, si viene, por `p_empresa_id`.
- `puedo_registrar_envios_moto(p_empresa_id uuid default null) returns boolean` — solo lectura: la misma regla que `registrar_envio_moto` (`ventas` en edición y rol Operador o Administrador en la tienda; con `null`, en alguna tienda accesible). La pantalla la usa para mostrar «Registrar envío».

## F-VTA-25

- `rendir_envios_moto(p_ids uuid[]) returns jsonb` — `{ "cantidad": n, "mensajero": "…" | null, "total_abono": x, "total_costo": y, "neto": x−y }` (`mensajero` null si no quedó nada pendiente); todo o nada, idempotente (los ids ya rendidos se ignoran y no duplican el evento; si todos ya lo estaban, `cantidad` 0 y totales 0); solo envíos **enviados y no rendidos** de un **mismo mensajero** (normalizado sin mayúsculas ni espacios sobrantes); exige Administrador; escribe solo `rendido` y `rendido_en`. No revierte.
- `resumen_motos_sin_rendir(p_empresa_id uuid default null) returns table (monto numeric, entregas integer)` — suma de `abono` de los envíos sin rendir con `abono > 0` y su cantidad, sobre empresas accesibles y el filtro opcional.

## Eventos de actividad (`public.registro_actividad`)

- `envio_moto.registrado` (FR-009) · `envio_moto.actualizado` (FR-009) · `envio_moto.rendido` (FR-024).
- Cada evento lleva actor, comprobante/envíos, mensajero, fecha y, en la rendición, cantidad y totales. Sin evento de reversión (fuera de alcance).
