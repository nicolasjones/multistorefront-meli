# Validación del outbox

1. Levantar Supabase y Kestra locales.
2. Crear una solicitud manual autorizada y verificar una ejecución y una orden pendiente.
3. Reclamarla como `kestra_orquestacion`; un reclamo concurrente no la obtiene.
4. Dejar vencer el reclamo y verificar recuperación con intento auditado.
5. Simular agotamiento y verificar estado terminal y error sanitizado.
6. Ejecutar pgTAP, `pnpm infra:config:kestra` y una adopción real antes de retirar el trigger HTTP del producto.
# Evidencia local (2026-09-23)

Se ejecutó el contrato real con una conexión local `kestra_orquestacion`: el
primer reclamo produjo intento 1, el vencimiento produjo intento 2, la
liberación dejó la orden pendiente, el reclamo siguiente produjo intento 3 y
el límite la dejó agotada. No se usaron ni registraron credenciales externas.
