# Contratos · Ventas cobros y conciliación (MSF-195)

Todas las RPC: esquema `public`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración (las de lectura `security invoker`; las de escritura `security definer`). La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Las de escritura exigen `ventas` en `edicion` en la empresa del comprobante más la acción indicada. Errores: `42501` (permiso), `22023` (dato inválido), `55000` (estado no válido), `P0001`/`40001` (conflicto o tope), con mensaje en castellano. Los tipos exactos de totales se verifican contra `main` al implementar. Todo es **nuevo**: no cambia la firma de nada existente (sin `BREAKING`).

## F-VTA-12 · Cobros por comprobante

- `registrar_cobro(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid, p_cuenta_cobro_id uuid default null, p_actualizado_en timestamptz default null) returns dominio.cobros_comprobante` — acción `registrar_cobro`; factura confirmada no anulada; importe > 0 y ≤ saldo; cuenta exigida según la forma de pago, activa y habilitada para la empresa; bloqueo de fila; evento `comprobante.cobro_registrado`.
- `cobros_de_comprobante(p_comprobante_id uuid) returns table (id uuid, fecha timestamptz, forma_pago text, cuenta_cobro text, importe numeric, origen text, conciliado boolean, aprobado_por text, registrado_por text)` — lectura (`ventas` ≥ `lectura`).
- `saldo_comprobante(p_id uuid) returns table (total numeric, cobrado numeric, saldo numeric)` — lectura.
- `private.registrar_cobro_interno(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid, p_cuenta_cobro_id uuid, p_origen text, p_actor uuid) returns uuid` — valida tope y aplica Cobrado/Deuda con `private.marcar_estado_cobro_comprobante`; usada por `registrar_cobro` y por F-VTA-14 (no ejecutable por `authenticated`).

## F-VTA-13 · Conciliación de pagos

- `listar_pagos(p_empresa_id uuid default null, p_cuenta_cobro_id uuid default null, p_solo_con_saldo boolean default false, p_pagina integer default 1, p_tamano integer default 10) returns table (id uuid, fecha timestamptz, empresa_id uuid, empresa text, comprobante_id uuid, numero text, cliente text, cuenta_cobro_id uuid, cuenta_cobro text, importe numeric, aprobado_por text, conciliado boolean, saldo numeric, actualizado_en timestamptz, filas bigint)` — solo cobros con cuenta de cobro.
- `resumen_pagos(p_empresa_id uuid default null) returns table (por_conciliar_importe numeric, por_conciliar_cantidad bigint, conciliado_importe numeric, conciliado_cantidad bigint, saldo_pendiente numeric)`.
- `cuentas_cobro_mas_usadas(p_empresa_id uuid default null, p_limite integer default 8) returns table (id uuid, nombre text, banco text, activa boolean, usos bigint, total_cuentas bigint)` — alimenta la tarjeta Cuentas de cobro.
- `conciliar_pago(p_id uuid, p_actualizado_en timestamptz) returns dominio.cobros_comprobante` — acción `conciliar_pago`; idempotente; rechaza cobros sin cuenta; eventos `pago.conciliado`.
- `revertir_conciliacion_pago(p_id uuid, p_actualizado_en timestamptz) returns dominio.cobros_comprobante` — ídem; evento `pago.conciliacion_revertida`.

## F-VTA-14 · Contrarreembolsos

- `private.abrir_contrarreembolso(p_comprobante_id uuid, p_transporte_id uuid, p_guia text) returns uuid` — punto de entrada para la guía de despacho de F-VTA-16 (MSF-135); solo transportes con `cobra_contrarreembolso`; idempotente por (comprobante, guía); no ejecutable por `authenticated`.
- `listar_contrarreembolsos(p_empresa_id uuid default null, p_estado text default null, p_pagina integer default 1, p_tamano integer default 10) returns table (id uuid, fecha timestamptz, empresa_id uuid, empresa text, comprobante_id uuid, numero text, cliente text, transporte_id uuid, transporte text, guia text, importe numeric, estado text, actualizado_en timestamptz, filas bigint)` — `p_estado` ∈ (`pendiente`, `cobrado`).
- `resumen_contrarreembolsos(p_empresa_id uuid default null) returns table (pendiente_importe numeric, pendiente_cantidad bigint, cobrado_mes_importe numeric)`.
- `marcar_contrarreembolso_cobrado(p_id uuid, p_actualizado_en timestamptz) returns dominio.contrarreembolsos` — acción `cobrar_contrarreembolso`; idempotente; registra el cobro con origen `contrarreembolso` vía `private.registrar_cobro_interno`; rechaza comprobante anulado.
