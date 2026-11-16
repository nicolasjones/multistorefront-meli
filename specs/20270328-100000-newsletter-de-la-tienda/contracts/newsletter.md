# Contratos: Newsletter de la tienda (MSF-468)

Interfaces **internas** (RPC de Postgres, flows de Kestra); no son la API pública `api-v1` (sin cambios en `openapi/*.json`). Los nombres y firmas son los previstos; se afinan al implementar sin cambiar el contrato observable. Errores comunes: `42501` (sin permiso), `P0002` (inexistente o de otra organización), `22023` (valor inválido), `40001` (el borrador cambió), `55000` (bandera apagada o envío ya cerrado).

## RPC públicas de la tienda (esquema `publico`; las únicas ejecutables por `anon`)

| Función | Entrada | Respuesta |
|---|---|---|
| `publico.newsletter_por_dominio(p_host text)` | host de la tienda | `{ activo: boolean, tienda: text \| null }` — `activo` solo con bandera y tienda activas; el resto de los casos es `{ activo: false }` |
| `publico.suscribirse_newsletter(p_host text, p_correo text, p_consentimiento boolean, p_clave uuid, p_trampa text)` | correo, casilla marcada, clave por intento, campo trampa | `{ resultado: 'ok' }` \| `{ resultado: 'invalido', campos: [...] }` \| `{ resultado: 'limite', espera_segundos: n }` \| `{ resultado: 'error' }` |
| `publico.confirmar_newsletter(p_host text, p_token text)` | host y token del correo | `{ resultado: 'ok' \| 'vencido' \| 'invalido' }` |

Reglas: correo recortado y en minúsculas, ≤ 254, una sola dirección; `p_consentimiento` debe ser `true`; `p_trampa` no vacío responde `ok` sin guardar; el límite es el de `private.registrar_envio_tienda(empresa, 'newsletter', clave)` (5/h por visitante HMAC y tienda, idempotente por clave) más 3 confirmaciones por dirección y 24 h; `ok` es idéntico para dirección nueva, existente o en baja. Nunca se devuelven ids, hash, IP ni el estado de la dirección.

## RPC del panel (esquema `public`, `security definer`, `search_path = ''`, `grant execute` a `authenticated`)

| Función | Permiso | Devuelve |
|---|---|---|
| `resumen_newsletter(p_empresa uuid)` | lectura en `clientes` | `{ confirmados, pendientes, bajas, envios }` (`p_empresa` nulo = todas las accesibles) |
| `listar_suscriptores_newsletter(p_empresa, p_estado, p_texto, p_pagina, p_tamano)` | lectura en `clientes` | `{ total, filas: [{ id, correo, empresa_id, tienda, origen, creado_en, estado }] }` (búsqueda literal; tamaño ≤ 100) |
| `guardar_newsletter_configuracion(p_empresa, p_activo)` | Administrador | `{ empresa_id, activo }`; `55000` con bandera apagada |
| `dar_de_baja_suscriptor_newsletter(p_suscriptor uuid)` | Administrador | `{ ok }`; idempotente; omite pendientes; evento `newsletter.baja_manual` |
| `borrar_datos_suscriptor_newsletter(p_suscriptor uuid)` | Administrador | `{ ok }`; elimina la fila y deja `[eliminado]` en los correos copiados; evento `newsletter.datos_borrados` (siempre disponible, aun con la bandera apagada) |
| `guardar_newsletter(p_id, p_version, p_empresa, p_nombre, p_asunto, p_mensaje, p_destacados, p_promociones)` | Administrador y acceso a la tienda | `{ id, version }`; `40001` si cambió; `55000` si ya se envió |
| `descartar_newsletter(p_id)` | Administrador | `{ ok }`; solo borradores |
| `detalle_newsletter(p_id)` | lectura en `clientes` | borrador o envío con la foto enviada y los totales |
| `vista_previa_newsletter(p_empresa, p_mensaje, p_destacados, p_promociones)` | Administrador | `{ bloques, confirmados, generado_en, html }`: la misma foto y el mismo HTML que el envío (un solo renderizado, `private.cuerpo_html_newsletter`), con un enlace de baja de ejemplo |
| `solicitar_prueba_newsletter(p_empresa, p_asunto, p_mensaje, p_destacados, p_promociones)` | Administrador | `{ ok }`; deja la prueba al correo del autor; tope 5/h |
| `enviar_newsletter(p_id, p_version, p_clave uuid)` | Administrador y acceso a la tienda | `{ campana_id, destinatarios }`; `22023` hint `sin_destinatarios`; idempotente por clave |
| `cancelar_envio_newsletter(p_id)` | Administrador | `{ cancelados }` (pendientes pasados a `omitido`) |
| `listar_newsletters(p_empresa, p_estado, p_pagina, p_tamano)` | lectura en `clientes` | `{ total, filas: [{ id, nombre_interno, empresa_id, tienda, asunto, fecha, destinatarios, enviados, fallidos, omitidos, pendientes, bajas, estado }] }` con `estado` en `borrador`, `enviando`, `enviada`, `cancelada` |

## Forma de `bloques` (foto del contenido)

```json
{
  "generado_en": "2027-03-28T12:00:00Z",
  "tienda": { "nombre": "Mundo JC", "dominio": "mundojc.example" },
  "destacados": [{ "producto_id": "uuid", "nombre": "…", "precio": 12345.0, "imagen_url": "https://…", "url": "https://dominio/producto/…" }],
  "promociones": [{ "producto_id": "uuid", "nombre": "…", "precio": 10000.0, "precio_promocional": 8000.0, "imagen_url": null, "url": "https://…", "hasta": "2027-04-05T00:00:00Z" }]
}
```

Hasta 6 elementos por sección; una sección apagada o sin elementos no aparece. Todo texto se escapa al renderizar (panel y flow).

## Funciones internas (`private`)

| Función | Quién la ejecuta | Qué hace |
|---|---|---|
| `private.reclamar_confirmaciones_newsletter(p_lote integer, p_vence_seg integer)` | `kestra_orquestacion` | Poda `pendiente` > 7 días; reclama confirmaciones por enviar; devuelve `{ suscriptor_id, correo, tienda, dominio, token }` (el token se genera acá y solo se guarda su hash) |
| `private.cerrar_confirmacion_newsletter(p_suscriptor uuid, p_resultado text, p_error text)` | `kestra_orquestacion` | Idempotente; marca `confirmacion_enviada_en` o deja reintento |
| `private.armar_bloques_newsletter(p_empresa uuid, p_destacados boolean, p_promociones boolean)` | funciones `security definer` | Arma `bloques` desde `productos_tienda`, `productos` y `promociones_precio` con el precio público de la tienda |
| `private.reclamar_lote_correo_masivo(...)` (extendida) | `kestra_orquestacion` | Mismos parámetros y columnas, más `tipo`, `tienda`, `remitente`, `dominio_tienda`, `cuerpo_html` al final; re-verifica al suscriptor (`confirmado`, tienda e interruptor activos) |
| `private.cuerpo_html_newsletter(mensaje, bloques, tienda, enlace_baja)` / `private.escapar_html` / `private.remitente_newsletter` | funciones `security definer` y el reclamo | HTML del correo (todo escapado, enlaces solo `https://`), y remitente saneado |

## Eventos de Actividad

`newsletter.configurar`, `newsletter.guardar`, `newsletter.enviar` (asunto y cantidad), `newsletter.cancelar`, `newsletter.baja_manual`, `newsletter.baja` (solo la primera baja), `newsletter.datos_borrados`. Ninguno lleva correos, mensajes ni cuerpo.

## Kestra

- **`newsletter-confirmaciones`** (nuevo, cada minuto, rol `kestra_orquestacion`): reclama → envía el correo de confirmación (enlace `https://{dominio}/newsletter/confirmar/{token}`, vence 48 h) → cierra. Reintentos 4 veces (30 s, 60 s, 2 min); motivo fijo en el fallo.
- **`correo-masivo`** (existente): si la fila trae `tipo = 'newsletter'`, usa el `cuerpo_html` que arma la base (con `bloques`, pie fijo y baja en `https://{dominio}/newsletter/baja/{token}`) y el remitente `"{tienda}" <KESTRA_SMTP_FROM>`; si no, sale como hoy.

## Edge Function

`baja-correo-masivo` (`{ token }` → `{ ok: true }`, 400 si el formato es inválido) **sin cambios de contrato**: el hash del token se resuelve contra los destinatarios, sean clientes o suscriptores.

## Bandera

`public.banderas_plataforma`, clave `newsletter`, **apagada por defecto**: `update public.banderas_plataforma set activa = true where clave = 'newsletter';` (equipo técnico o Nicolás; no una migración).
