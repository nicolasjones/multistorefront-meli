# Contratos · Ventas listado, estados y anulación (MSF-177)

Todas las RPC: esquema `public`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración (las de lectura `security invoker` —salvo `historial_comprobante`, `security definer` porque `registro_actividad` exige la sección `actividad`; valida organización y `ventas` ≥ `lectura` en la empresa del comprobante—; las de escritura `security definer`). La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Las de escritura exigen la acción indicada y, en F-VTA-10, `ventas` ≥ `lectura` en la empresa del comprobante: la matriz de transiciones por rol es la autoridad (Depósito tiene `ventas` en lectura y debe poder armar). Errores: `42501` (permiso), `22023` (dato inválido), `55000` (estado no válido), `P0001`/`40001` (conflicto o tope), con mensaje en castellano. Los tipos exactos de retorno de totales se verifican contra `main` al implementar.

## F-VTA-10 · Estados

- `cambiar_estado_comprobante(p_id uuid, p_estado text, p_actualizado_en timestamptz) returns dominio.comprobantes_venta` — valida la transición en `dominio.transiciones_estado_comprobante` para el rol del actor en la empresa del comprobante; idempotente; rechaza `borrador`, `anulada`, presupuestos, `cobrado` y `deuda`.
- `transiciones_permitidas_comprobante(p_id uuid) returns text[]` — estados a los que el rol de la sesión puede pasar hoy (informativa, para habilitar/deshabilitar chips); la autoridad sigue siendo `cambiar_estado_comprobante`.
- `historial_comprobante(p_id uuid) returns table (cuando timestamptz, accion text, quien text, empresa_id uuid, empresa text)` — eventos del comprobante, más recientes primero; `security definer` con organización, `ventas` ≥ `lectura` en la empresa del comprobante y filtro por empresa y número (FR-025).
- `private.sembrar_transiciones_comprobante(p_organizacion_id uuid) returns void` — siembra la matriz inicial (no ejecutable por `authenticated`).
- `private.marcar_estado_cobro_comprobante(p_id uuid, p_estado text) returns void` — `p_estado` ∈ (`cobrado`, `deuda`); punto de entrada para MSF-195 (no ejecutable por `authenticated`).

## F-VTA-09 · Listado y exportación

- `listar_comprobantes(p_busqueda text default null, p_estado text default null, p_pago_id uuid default null, p_envio_id uuid default null, p_operador_id uuid default null, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10) returns table (...)` — columnas: id, numero, tipo, empresa_id, empresa, fecha, cliente, operador, estado, forma_pago, envio, total (con signo), filas (conteo total). Solo `factura` y `nota_credito`.
- `operadores_de_comprobantes(p_empresa_id uuid default null) returns table (id uuid, nombre text)` — opciones del filtro Operador.
- `exportar_comprobantes(p_tipo text, p_busqueda text default null, p_estado text default null, p_pago_id uuid default null, p_envio_id uuid default null, p_operador_id uuid default null, p_empresa_id uuid default null) returns table (...)` — `p_tipo` ∈ (`comprobantes`, `presupuestos`); mismas columnas que el listado, hasta 10.000 filas; exige la acción `exportar` de `ventas`.
- `solicitar_exportacion_comprobantes(p_tipo text, p_filtros jsonb) returns uuid` — registra una ejecución del worker `exportar-comprobantes` (más de 10.000 filas); devuelve el id de la ejecución; bloquea simultáneas por usuario.

## F-VTA-11 · Anulación y nota de crédito

- `anular_comprobante(p_id uuid, p_motivo text, p_actualizado_en timestamptz) returns dominio.comprobantes_venta` — solo factura confirmada, sin nota de crédito y no cobrada; `p_motivo` obligatorio; todo o nada; idempotente; exige la acción `anular`.
- `private.revertir_venta_comprobante(p_id uuid) returns void` — entradas inversas y liberación de reservas (no ejecutable por `authenticated`).
- `emitir_nota_credito(p_factura_id uuid, p_tipo text, p_lineas jsonb, p_concepto text default null) returns dominio.comprobantes_venta` — `p_tipo` ∈ (`devolucion_productos`, `devolucion_importe`, `descuento`); `p_lineas`: arreglo de `{linea_id, cantidad}` para productos o `{importe_sin_iva}` para los otros; exige la acción `emitir_nota_credito`; no excede lo acreditable.
- `private.devolver_stock_nota_credito(p_nota_id uuid) returns void` — entrada al depósito de origen (solo `devolucion_productos`; no ejecutable por `authenticated`).
- `private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text) returns boolean` — ajuste: cuenta también la `nota_credito` emitida, con signo negativo en las sumas.
BREAKING: `private.comprobante_cuenta_como_facturado` pasa a devolver verdadero para `nota_credito` emitida (antes solo facturas no `borrador` ni `anulada`); es interna del ranking de clientes (F-CLI-08) y del listado, y las lecturas que la usan restan el importe de las notas; se verifica al implementar que el conteo de comprobantes del ranking no suma la nota.
