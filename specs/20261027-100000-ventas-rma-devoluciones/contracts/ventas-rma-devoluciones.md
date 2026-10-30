# Contratos · Ventas RMA y devoluciones (MSF-178)

Todas las RPC: esquema `public`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración. Las de lectura (`listar_rma`) son `security invoker`; las de escritura (`registrar_rma`, `cambiar_estado_rma`, `vincular_nota_credito_rma`, `reingresar_stock_rma`) son `security definer`. La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Errores: `42501` (permiso), `22023` (dato inválido), `55000` (estado no válido), `P0001`/`40001` (conflicto o tope), con mensaje en castellano. Los tipos exactos de retorno se verifican contra `main` al implementar.

Formas de RMA (`forma_rma`): `cambio_directo`, `enviado_a_proveedor`, `faltante_envio`, `reclamo_faltante`, `devolucion_importe`.
Estados (`estado`): `abierto`, `en_gestion`, `cerrado`.

## F-VTA-28 · Alta por ítem

- `registrar_rma(p_comprobante_id uuid, p_lineas jsonb, p_forma_rma text, p_motivo text, p_observaciones text default null) returns dominio.rma` — factura confirmada no anulada; `p_lineas` = arreglo de `{linea_id, cantidad}`; cantidad ≤ lo vendido y lo aún no devuelto; asigna `RMA-####`; exige `ventas` ≥ `edición` en la empresa del comprobante.
- `listar_rma(p_busqueda text default null, p_forma_rma text default null, p_estado text default null, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10) returns table (...)` — columnas: id, numero, empresa_id, empresa, comprobante_numero, cliente, producto, cantidad, forma_rma, motivo, operador, estado, filas. `security invoker`, `ventas` ≥ `lectura`, empresas accesibles.

## F-VTA-29 · Formas y seguimiento

- `cambiar_estado_rma(p_id uuid, p_estado text, p_actualizado_en timestamptz) returns dominio.rma` — transición lineal `abierto → en_gestion → cerrado`; bloqueo optimista; idempotente; exige `ventas` ≥ `edición` en la empresa del RMA.

## F-VTA-30 · Nota de crédito y stock

- `vincular_nota_credito_rma(p_rma_id uuid, p_tipo text, p_lineas jsonb, p_concepto text default null) returns dominio.rma` — `p_tipo` ∈ (`devolucion_importe`, `devolucion_productos`); reutiliza `public.emitir_nota_credito` (F-VTA-11); asigna `rma.nota_credito_id`; cierra el RMA; exige `emitir_nota_credito`; idempotente.
- `reingresar_stock_rma(p_rma_id uuid, p_deposito_id uuid default null) returns dominio.rma` — entrada por ítem reutilizando `public.registrar_movimiento_stock` (MSF-136) con motivo «Devolución» y nota `RMA {número}`; cierra el RMA; exige `ventas` ≥ `edición`; idempotente.
