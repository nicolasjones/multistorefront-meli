# Fix MSF-598 — despachar facturas en cualquier estado vivo

**Causa:** `cambiar_estado_despacho`, `registrar_faltantes_despacho` y `guardar_envio_comprobante` exigían `estado = 'confirmada'`; al cobrar o aceptar la factura quedaba trabada.

**Cambio:** las tres RPC aceptan los estados vivos (`confirmada`, `aceptado`, `en_proceso`, `armando`, `incompleto`, `cobrado`, `deuda`) y rechazan `anulada`, borrador y pendiente. La UI usa `ESTADOS_DESPACHABLES` (misma lista).
Migraciones: `20270121121400_despacho_estados_vivos.sql`, `20270121121500_faltantes_envio_estados_vivos.sql` (aditivas: `create or replace`).

**Devolución del Revisor:** comentarios y encabezado de la migración alineados con la regla nueva; tests pgTAP de faltantes y envío en Cobrado/Deuda/Aceptado/En proceso y rechazo de Anulada; comentarios cruzados que atan las listas SQL ↔ UI (centralizar en una función `private` queda como mejora aparte, sin cambio de contrato).

**Reversión:** volver a la versión anterior de las RPC (`create or replace` con la regla `confirmada`).
