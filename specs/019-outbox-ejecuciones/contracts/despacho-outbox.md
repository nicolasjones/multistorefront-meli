# Contrato: despacho por outbox

La operación `public.iniciar_ejecucion_worker` crea la ejecución y, para el
origen `manual`, una orden durable en la misma transacción. El usuario solo
recibe el ID de ejecución; no recibe secretos, URL de Kestra ni datos de
conexión.

Kestra se conecta por JDBC con el rol `kestra_orquestacion` y reclama un lote
mediante `private.reclamar_despachos_ejecucion(limite, duracion_seg)`. Cada
fila contiene únicamente `despacho_id`, `ejecucion_id`, `organizacion_id`,
`conexion_id`, `clave_capacidad`, detalle sanitizado, intento y vencimiento.
El reclamo es exclusivo y vence. El máximo actual es 100 órdenes y 3600
segundos por reclamo.

La confirmación, liberación transitoria y agotamiento se incorporan en la fase
de recuperación de esta spec. El worker conserva el cierre de ejecución
existente. Solo el rol técnico puede reclamar; no viajan secretos, URLs ni logs
crudos.
