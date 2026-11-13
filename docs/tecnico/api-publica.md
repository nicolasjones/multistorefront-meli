---
owner: tecnico
sources: []
---

# API pública: diseño y operación

Resumen técnico de la API pública de solo lectura de MSF (épica MSF-233, F-API-01) para quien mantiene el sistema. Para quien **integra**, ver [Empezar con la API](../api/inicio-rapido.md) y la [Referencia de la API](../api/referencia.md); para quien **administra** claves y avisos, el [manual de API y avisos](../producto/api-y-avisos.md). La guía técnica completa (`docs/api-publica.md`) y la spec viven en la rama de desarrollo hasta la próxima promoción a `main`.

## Piezas

| Pieza | Qué hace |
|---|---|
| Edge Function `api-v1` | Autentica la clave, controla el límite y lee con las RPC `private.api_leer_*`. Desplegada con `verify_jwt = false`: la clave de API no es un JWT de Supabase |
| Edge Function `entregar-webhook` | Entrega un aviso firmado (HMAC-SHA256) a la URL de la suscripción; solo la llama Kestra con el token de servicio |
| Flow de Kestra `entregar-webhooks-api` | Cada minuto reclama eventos y entregas (lote `API_WEBHOOKS_LOTE`, por defecto 20) |
| Flow `purgar-api-llamadas` | Purga diaria de llamadas (90 días por defecto) y de claves revocadas o vencidas |
| Pantalla **Administración → API** | Claves, suscripciones, entregas y llamadas recientes |

## Decisiones de diseño

- **Organización siempre de la clave**; el filtro vive dentro del SQL, no en TypeScript.
- **Hash SHA-256** de la clave (256 bits de entropía, no necesita hash lento) y prefijo para auditar intentos fallidos.
- **Límite por clave** (60 por minuto, ventana deslizante en la base con reserva de llamada) y tope de 600 por minuto para llamadas sin clave válida, solo para acotar la tabla de auditoría.
- **Entrega al menos una vez**: la base gobierna reintentos (5 intentos en total, espera mínima 1, 2, 4 y 8 minutos) y el receptor deduplica por `id`.
- **SSRF**: se exige `https`, sin credenciales y sin direcciones internas; se conecta a la IP ya resuelta y validada, y no se siguen redirecciones.
- **Secretos de firma** en Vault; nunca llegan al navegador. Rotables con gracia de 24 h: durante ese tiempo cada aviso lleva dos firmas (`X-Firma: t=…,v1=<nuevo>,v1=<anterior>`).
- **Versionado por ruta** (`/v1/`): los cambios aditivos no rompen la versión.

## Operación

- Después de desplegar `api-v1` o `entregar-webhook`, llamar a `GET /api-v1/v1/openapi.json` (200 sin clave) y a una ruta con clave inválida (401 en JSON). Si responde `404 Function not found`, hay que recrear el stack del runtime de Edge.
- El sitio de documentación completo está detrás de contraseña; la guía y la referencia se publican aparte en `/api-publica/` ([subsitio público](subsitio-api-publica.md)).

## Deuda conocida (seguimientos trazados)

| Tema | Seguimiento |
|---|---|
| **Hecho:** la purga diaria borra los eventos terminados con más de 90 días y sin entregas vivas (se siguen encolando eventos aunque no haya suscripción: la cola es una outbox genérica) | MSF-836 |
| **Hecho:** el flow `monitoreo-api-entregas` (cada 15 minutos) avisa por correo a soporte si hay entregas agotadas o atrasadas o eventos sin repartir; la purga también avisa si falla. Falta confirmar la primera ejecución en un Kestra real | MSF-837 |
| **Hecho:** reintento manual de entregas agotadas por el Administrador (botón **Reintentar**, tope de 200 esperando). El backoff sigue siendo de unos 15 minutos en total | MSF-838 |
| **Hecho:** rotación del secreto de una suscripción con gracia de 24 h y doble firma; tras un restore en otra instancia hay que rotar cada secreto | MSF-839 |
| Capacidad del pipeline de avisos (global, no por organización): hay que medir con volumen real antes de decidir | MSF-840 |
| Ampliar la API a escritura (prerrequisitos de arquitectura en su descripción) | MSF-835 |

Límites conocidos de los datos: `stock.actualizado` no se emite por movimientos de variantes ni por traslados entre depósitos, y en ventas la consulta incremental (`actualizado_desde`) filtra por la fecha de confirmación, por lo que no ve cambios de estado ni anulaciones.
