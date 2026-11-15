---
owner: tecnico
sources:
  - specs/20270328-100000-newsletter-de-la-tienda
  - supabase/migrations/20270342000000_newsletter_suscripcion.sql
  - supabase/migrations/20270342000100_newsletter_publico.sql
  - supabase/migrations/20270342000200_newsletter_confirmaciones.sql
  - supabase/migrations/20270342000300_exportacion_total_newsletter.sql
  - infra/kestra/flows/newsletter-confirmaciones.yml
  - apps/web/src/lib/tiendaNewsletter.ts
  - apps/web/src/pages/tienda-publica/newsletter
  - apps/web/src/pages/tienda-publica/rutas/newsletter.confirmar.tsx
---

# Tiendas online · Newsletter de la tienda (MSF-468)

Spec: `specs/20270328-100000-newsletter-de-la-tienda/`. Este documento cubre **las Fases 1 y 2** de `tasks.md` (base de la suscripción y
confirmación por correo con el formulario en el pie de la tienda). **Todavía no existe ninguna pantalla del panel, ninguna baja desde
el correo ni ningún envío de newsletter**: ninguna pieza de estas fases envía un newsletter y el correo masivo a clientes (MSF-155,
`docs/correo-masivo.md`) no cambia. Lo que sale por correo en estas fases es solamente el mensaje de **confirmación** de la suscripción.

## Apagado por defecto

- Bandera de plataforma `newsletter` en `public.banderas_plataforma`, **apagada** (la migración solo inserta la fila).
- Interruptor por tienda en `dominio.newsletter_configuracion.activo`, **apagado** (sin fila = apagado). En estas fases no hay pantalla
  para encenderlo: se hace por SQL en dev para probar.
- Con cualquiera de los dos apagados: el pie no muestra el formulario, `publico.suscribirse_newsletter` responde `error` (idéntico para
  host desconocido, tienda desactivada, interruptor apagado y bandera apagada), `publico.confirmar_newsletter` responde `invalido` y el
  reclamo de confirmaciones no entrega nada (no sale ningún correo).
- Encender (equipo técnico o Nicolás; no es una migración): `update public.banderas_plataforma set activa = true where clave = 'newsletter';`
  y, por tienda, `insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values (…, …, true) on conflict (empresa_id) do update set activo = true;`.
  Apagar: la misma sentencia con `false`.

## Qué hay

| Capa | Pieza |
|---|---|
| Base | `dominio.newsletter_configuracion` y `dominio.newsletter_suscriptores` (RLS por organización y tienda accesible; `authenticated` solo `select` por columna, sin `confirmacion_hash`; `anon` sin privilegios; `service_role` como las demás tablas operativas); el check de `dominio.tienda_envios.origen` suma `newsletter` |
| RPC públicas (`publico`, únicas ejecutables por `anon`) | `newsletter_por_dominio(p_host)`, `suscribirse_newsletter(p_host, p_correo, p_consentimiento, p_clave, p_trampa)`, `confirmar_newsletter(p_host, p_token)` |
| Internas (`private`) | `empresa_newsletter_activa`, `validar_suscripcion_newsletter`, `version_consentimiento_newsletter`; `reclamar_confirmaciones_newsletter` y `cerrar_confirmacion_newsletter` (solo `kestra_orquestacion`) |
| Kestra | `infra/kestra/flows/newsletter-confirmaciones.yml` (cada minuto; variable `NEWSLETTER_CONFIRMACION_LOTE`, 20) |
| Front público | `FormularioSuscripcion` en el pie (`PieCategorias`), `lib/tiendaNewsletter.ts`, `hooks/useNewsletterTienda.ts`, ruta `/newsletter/confirmar/:token` (`rutas/newsletter.confirmar.tsx`) |
| Exportación total | las dos tablas entran a `private.conjuntos_exportacion_total()`; `confirmacion_hash` queda fuera del volcado |
| Pruebas | pgTAP `newsletter_suscripcion`, `newsletter_bandera`, `newsletter_aislamiento`, extensiones de `tienda_contacto`, `tienda_capacidades` y `exportacion_total`; `test:kestra:newsletter-confirmaciones`; Vitest del formulario, la página de confirmación y `lib/tiendaNewsletter` |

## Flujo y decisiones (spec D1, D2, D4)

1. El visitante escribe su correo, marca la casilla (obligatoria y sin marcar) y pulsa «Suscribirme». La base valida **antes** del límite
   (un correo inválido no consume cupo), aplica el límite por visitante (`private.registrar_envio_tienda(empresa, 'newsletter', clave)`:
   5 por hora por visitante HMAC y tienda, **compartido** con contacto y WhatsApp, idempotente por clave) y el tope de **3 confirmaciones
   por dirección y 24 h**, y deja la suscripción `pendiente` con su consentimiento (versión del texto, sin IP ni nombre).
2. La respuesta es `ok` idéntica para dirección nueva, existente (pendiente o confirmada), en baja, con el campo trampa lleno o con el tope
   superado: no se enumeran suscriptores. Una dirección en baja vuelve a `pendiente` con nuevo consentimiento.
3. El flow reclama las confirmaciones por enviar, genera un token de 244 bits **por envío** (solo se guarda su SHA-256), con vencimiento a las
   **48 h**, y envía el correo por el SMTP de Kestra con el nombre de la tienda como remitente visible. Un fallo se reintenta 4 veces en el
   flow y hasta 4 ciclos; el motivo es siempre fijo (nunca el mensaje del SMTP). El nombre de la tienda sale de la base sin comillas, `<`, `>`
   ni caracteres de control (sin inyección de encabezados).
4. El enlace `https://{dominio}/newsletter/confirmar/{token}` abre la página que confirma (`ok`, `vencido`, `invalido`; un enlace ya usado
   responde `ok`). El token de otra tienda no confirma. Las suscripciones `pendiente` de más de 7 días se purgan en el reclamo (sin cron nuevo).

`publico.confirmar_newsletter` también responde `limite` (con `espera_segundos`) si el visitante superó el cupo por hora; la página lo muestra
como «Probá de nuevo en unos minutos». Es el único agregado al contrato de la spec.

## Verificación técnica pendiente

- T011(a): si el plugin `MailSend` de Kestra admite los encabezados `List-Unsubscribe` y `List-Unsubscribe-Post` (D3) no se verificó en estas
  fases: la confirmación no es un newsletter y no lleva baja. Se decide cuando exista el envío (Fase 5).
- T011(b): CORS de la Edge Function `baja-correo-masivo` para los dominios de las tiendas: se verifica con la página de baja (Fase 3).

## Reversión

Inmediata, sin código: `update public.banderas_plataforma set activa = false where clave = 'newsletter';` (el pie deja de mostrar el formulario y el
flow no envía). Migraciones posteriores (nunca en el mismo PR): `drop function` de las funciones de las migraciones `…0100` y `…0200`,
`drop table dominio.newsletter_suscriptores, dominio.newsletter_configuracion` (exportar antes los suscriptores si hace falta), borrar la fila de la
bandera, restaurar la definición de `private.conjuntos_exportacion_total()` de `20270334000002` y el check de `tienda_envios.origen` de
`20270321100000`.
