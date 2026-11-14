# Contrato: resumen semanal por correo (F-REP-08, MSF-265)

## Programación (Kestra, `infra/kestra/flows/resumen-semanal.yml`)

| Disparador | Cron | Zona | Para qué |
|---|---|---|---|
| `lunes_0800` | `0 8 * * 1` | `America/Argentina/Buenos_Aires` | Primer barrido de la semana |
| `reintentos` | `*/15 * * * *` | `America/Argentina/Buenos_Aires` | Reintentar lo que falló; es idempotente |

Cada ejecución hace `POST` a `{{ envs.resumen_semanal_url }}` con `{"barrer": true}` y las cabeceras `apikey`/`Authorization` (clave pública, solo cruza el gateway) y `x-aviso-token` (`secret('RESUMEN_SEMANAL_TOKEN')`).

## Edge Function `enviar-resumen-semanal`

- `POST {"barrer": true}` → procesa las organizaciones de `organizaciones_con_resumen_semanal_pendiente()`; responde `200 {procesadas, resultados, errores}` o `502` si hubo errores o resúmenes fallidos (Kestra marca la ejecución).
- `POST {"organizacion_id": "<uuid>"}` → procesa una (operador).
- Errores: `403` token ausente o distinto (no `401`: paridad con `enviar-resumen-reposicion`), `413` cuerpo de más de 64 KB (se lee con tope, después de validar el token), `503` sin `RESUMEN_SEMANAL_TOKEN` o sin `PANEL_URL`, `405` método, `400` organización inválida.
- Todos los administradores de la organización van juntos en un único mensaje («Para»); no se excluyen baneados ni correos sin confirmar (mismo criterio que el resumen de reposición).
- Los destinatarios nunca vienen del pedido.
- Variables de la función: `RESUMEN_SEMANAL_TOKEN`, `PANEL_URL`, `SMTP_*`. Variables de Kestra: `RESUMEN_SEMANAL_URL`, `RESUMEN_SEMANAL_APIKEY`, `SECRET_RESUMEN_SEMANAL_TOKEN` (base64).

## RPC (`public`, `security definer`, `search_path = ''`)

| Función | Quién | Qué hace |
|---|---|---|
| `organizaciones_con_resumen_semanal_pendiente()` | solo `service_role` | `uuid[]` de organizaciones con un resumen por generar o reintentar |
| `generar_resumen_semanal(p_organizacion uuid, p_tope integer = 5)` | solo `service_role` | Genera (dentro de la ventana) o reintenta el resumen de la semana que terminó; devuelve `resumen_id`, `organizacion_nombre`, `semana_desde`, `semana_hasta`, `contenido jsonb`, `destinatarios text[]`; 0 filas si no hay nada que enviar |
| `cerrar_resumen_semanal(p_resumen uuid, p_enviado boolean, p_error text)` | solo `service_role` | `enviado` / `fallido`; solo actúa sobre uno `pendiente` |
| `configurar_resumen_semanal(p_activo boolean)` | `authenticated` (administrador) | Activa o pausa; un cambio real registra `resumen_semanal.pausado|reanudado` en Actividad |
| `estado_resumen_semanal()` | `authenticated` (administrador) | `activo`, `proximo_envio`, `ultima_semana_desde`, `ultimo_estado`, `destinatarios` |

Internas (`private`, sin acceso de la app): `armar_resumen_semanal`, `generar_resumen_semanal_en` (permite probar la ventana), `organizaciones_con_resumen_semanal_pendiente_en`, `destinatarios_resumen_semanal`.

## Estados de `resumen_semanal_envios`

`pendiente` (reservado 2 min) → `enviado` | `fallido` (reintentable hasta 5 intentos) · `sin_destinatario` (se reevalúa en la ventana) · `pausado` (la pausa no toca uno en vuelo; si su correo salió, `cerrar(true)` lo pasa a `enviado`) · `vencido` (sin enviar de una semana anterior; nunca se manda atrasado). Único por `(organizacion_id, semana_desde)`.

## Contenido (`contenido jsonb`)

`desde`, `hasta`, `fuentes[]`, y las secciones presentes: `ventas {facturado, facturado_anterior, comprobantes, unidades, tiendas[]}`, `rentabilidad {vendido, margen, margen_pct, productos_en_riesgo}`, `stock {sin_stock, stock_bajo, productos[]}` (solo si hay), `faltantes {pendientes, unidades, dias_mas_antiguo}` (solo si hay). Solo agregados de la organización; nombres de producto únicamente en `stock.productos`.
