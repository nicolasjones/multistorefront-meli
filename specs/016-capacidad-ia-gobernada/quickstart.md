# Guía de validación

## Prerrequisitos

1. Levantar Supabase local y el producto requerido con los comandos `pnpm dev:<producto>`.
2. Migraciones locales aplicadas y un superadmin, una organización y un consumidor fixture disponibles.
3. Usar exclusivamente una clave de prueba efímera en Vault; nunca pegarla en archivos ni logs.

## Escenarios

1. Superadmin elige proveedor, carga clave y descubre modelos; la respuesta/UI no revela clave ni Vault ID.
2. Configura principal y fallback; se rechaza modelo ajeno o no descubierto.
3. Superadmin habilita una política global aprobada; un administrador de organización no puede ver ni modificar política, proveedor, modelo o clave.
4. Consumidor fixture declara contrato, envía sólo datos permitidos y recibe una respuesta validada y sanitizada.
5. Probar contrato, política, parámetro y esquema inválidos: todos terminan `rechazada` antes de un efecto externo.
6. Forzar timeout del principal: fallback se usa una vez dentro de dos intentos/90 segundos. Forzar rechazo local: no hay fallback.
7. Forzar agotamiento: queda `revision_humana`, alerta y vista exclusivamente superadmin en menos de dos minutos.
8. Revisar DB, Storage, stdout/stderr y ejecución Kestra: no contienen claves, tokens, payload no sanitizado ni datos excluidos por el contrato. Avanzar el reloj/fixture 90 días y comprobar purga idempotente.

## Puerta de calidad

Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test`; además, las suites Vitest, pgTAP y consumidor fixture arriba deben quedar verdes. Una validación estática de Kestra no reemplaza un recorrido real del consumidor que integre procesos aislados.
