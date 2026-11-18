---
owner: tecnico
sources:
  - specs/20270328-100000-newsletter-de-la-tienda
  - supabase/migrations/20270342000000_newsletter_suscripcion.sql
  - supabase/migrations/20270342000100_newsletter_publico.sql
  - supabase/migrations/20270342000200_newsletter_confirmaciones.sql
  - supabase/migrations/20270342000300_exportacion_total_newsletter.sql
  - supabase/migrations/20270420000000_newsletter_baja_y_gestion.sql
  - supabase/migrations/20270420000100_newsletters.sql
  - supabase/migrations/20270420000200_exportacion_total_newsletters.sql
  - supabase/migrations/20270420000300_newsletter_bloques_y_prueba.sql
  - supabase/migrations/20270420000400_newsletter_envio.sql
  - supabase/migrations/20270420000500_newsletter_lote.sql
  - supabase/migrations/20270420000600_newsletter_correo_sin_llaves.sql
  - infra/kestra/flows/correo-masivo.yml
  - apps/web/src/pages/clientes/newsletter
  - apps/web/src/lib/newsletter.ts
  - apps/web/src/pages/tienda-publica/rutas/newsletter.baja.tsx
  - infra/kestra/flows/newsletter-confirmaciones.yml
  - infra/kestra/flows/aviso-fallo-flujo.yml
  - apps/web/src/lib/tiendaNewsletter.ts
  - apps/web/src/pages/tienda-publica/newsletter
  - apps/web/src/pages/tienda-publica/rutas/newsletter.confirmar.tsx
---

# Tiendas online · Newsletter de la tienda (MSF-468)

Spec: `specs/20270328-100000-newsletter-de-la-tienda/`. Cubre las seis fases de `tasks.md`: base de la suscripción y confirmación por
correo con el formulario en el pie (Fases 1 y 2), baja y gestión de suscriptores (Fase 3), composición con vista previa y prueba (Fase 4),
envío por el motor del correo masivo (Fase 5) y el cierre (Fase 6). El correo masivo a clientes (MSF-155, `docs/correo-masivo.md`) conserva su
comportamiento: el newsletter **comparte su motor** (campañas, destinatarios, cupo diario, reclamos, baja por hash y SMTP de Kestra) con otra
lista y otro consentimiento. Guía para quien usa el panel: [Newsletter](producto/newsletter.md).

## Apagado por defecto

- Bandera de plataforma `newsletter` en `public.banderas_plataforma`, **apagada** (la migración solo inserta la fila).
- Interruptor por tienda en `dominio.newsletter_configuracion.activo`, **apagado** (sin fila = apagado). Con la bandera encendida lo
  enciende el Administrador desde `Contactos → Newsletter` («Mostrar suscripción en el pie de la tienda»); antes se hace por SQL.
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

## Límites y comportamientos a tener en cuenta

- **Forma estricta del correo**: parte local `atom(.atom)*` con `atom = [a-z0-9'+_=&*#$?^~-]+ (sin llaves desde la migración `…0600`)` (sin `%`, `!`, `|`, `/`, ni punto inicial, final o doble; local ≤ 64),
  dominio con etiquetas alfanuméricas (guiones solo en el medio) y TLD de dos o más letras (acepta punycode `xn--`; no acepta IP), total ≤ 254, en minúsculas. Sin `<`, `>`, comillas, paréntesis,
  `\`, `:`, `,` ni `;`. Así cada fila es una dirección real, sin rutas fuente legadas (`%`, `!`), y el tope de 3 confirmaciones por dirección y 24 h no se evade con formas como
  `a<victima@dom.com>`. El mismo criterio rige en la tabla (check), en `private.validar_suscripcion_newsletter` y en `lib/tiendaNewsletter.ts`.
- **Tope global por tienda y riesgo residual**: máximo 200 confirmaciones nuevas por hora y tienda (`private.tope_confirmaciones_hora_newsletter()`); superado, la suscripción
  no se guarda ni se envía y la respuesta sigue siendo `ok` (sin señal de tope). El tope por dirección no ve los alias de proveedor (`+tag`, puntos de Gmail, catch-all de un dominio):
  un atacante sigue pudiendo mandar hasta ese tope por hora a un mismo buzón; el límite por visitante (5/h) y el tope global lo acotan, y si aparece abuso real se agrega CAPTCHA
  (seguimiento). **Con el tope lleno, las altas legítimas se descartan EN SILENCIO** (la respuesta es `ok` pero el correo nunca llega) hasta una hora, y quien reúna 200 direcciones
  (unos 40 visitantes a 5/h) agota el cupo de la tienda: es un riesgo de disponibilidad (DoS) aceptado en estas fases. Mitigación: **alerta al alcanzar el tope** (hecha, ver «Seguimientos
  de seguridad y entregabilidad»: evento de Actividad `newsletter.tope_confirmaciones`, a lo sumo uno por hora y tienda); el CAPTCHA o el cupo por visitante quedan como propuesta documentada (MSF-971). El tope se cuenta bajo un lock por tienda (`pg_advisory_xact_lock`), de modo que dos suscripciones simultáneas no lo
  superan; la fila de la dirección se toma con `for update`, así que una re-suscripción nunca anula el hash que el flow acaba de reclamar. Un envío que agota sus 4 ciclos anula el enlace (hash y vencimiento), de modo que la persona puede pedir otro.
- **Invariante para las fases 3 a 5**: un tercero puede dejar `pendiente` a una dirección que estaba en `baja` (conserva `baja_en`). El reclamo de lote del correo masivo (MSF-155), los KPI de activos y la
  foto de destinatarios de `enviar_newsletter` filtran SIEMPRE `estado = 'confirmado'`, NUNCA `estado <> 'baja'`. Seguimiento: MSF-967.
- **Unicode e IDN**: el correo con unicode directo (`ñandú@x.com`, `user@bücher.de`) y un TLD punycode (`a@b.xn--p1ai`) se rechazan en la tabla, el validador y el cliente; un dominio
  internacionalizado entra con sus etiquetas `xn--` (`a@xn--bcher-kva.de`) y el TLD debe ser de letras ASCII.
- **Re-suscribir no invalida el enlace legítimo**: si la dirección ya está `pendiente` con un enlace vigente (48 h), un nuevo pedido responde `ok` pero no emite
  otro correo ni pisa el hash; quien perdió el correo puede volver a pedirlo cuando venza. Si la dirección estaba en `baja`, vuelve a `pendiente` (con
  correo de confirmación, hasta 3 en 24 h) y el enlace anterior deja de valer; `baja_en` se **conserva** hasta que se confirme y, si nunca se confirma, la
  poda de 7 días la devuelve a `baja` en lugar de borrarla (lista de supresión). Limitación: cualquiera puede pedir una confirmación a una dirección en baja (hasta 3 en
  24 h); no se envía ningún newsletter hasta que la persona confirme.
- **Robustez de los flows (`newsletter-confirmaciones.yml` y `correo-masivo.yml`)**: cada uno corre **una sola vez a la vez** (`concurrency: limit: 1`, `behavior: CANCEL`: si la corrida anterior sigue en curso, la nueva se descarta), el reclamo y los cierres tienen `timeout` de 1 minuto y el envío de 2, y un fallo del flow avisa al soporte por el subflow `aviso-fallo-flujo` (solo informa el nombre de la tarea que falló, no el mensaje del error). Con un solo flow en curso, el vencimiento del reclamo (900 s) es el plazo de recuperación ante una caída.
- **El cierre del flow no pisa un pedido nuevo**: `cerrar_confirmacion_newsletter` solo actúa sobre una suscripción `pendiente` con `confirmacion_hash` no nulo y con la confirmación por enviar (`confirmacion_enviada_en` nulo o anterior a `confirmacion_solicitada_en`); una re-suscripción que anuló el hash antes del cierre deja el cierre tardío sin efecto.
- **El límite por visitante es compartido**: `confirmar_newsletter` también consume el cupo (5/h por visitante y tienda, el mismo de contacto, WhatsApp y suscripción).
  Quienes comparten IP, o el cupo único `sin-ip` cuando falta la cabecera, pueden quedar bloqueados por un rato (responde `limite` y la página ofrece reintentar).
- El nombre de la tienda sale de la base sin `"`, `<`, `>`, `\` ni caracteres de control; el cuerpo HTML del correo lo escapa y el asunto (texto plano) sale tal cual, sin entidades.

## Baja, gestión, composición y envío (Fases 3 a 5)

| Capa | Pieza |
|---|---|
| Base | `dominio.newsletters` (borradores y envíos; RLS por organización y tienda accesible; `authenticated` solo `select`); columnas nuevas de las tres tablas del correo masivo (`campanas_correo.tipo/newsletter_id/bloques`, `campana_correo_destinatarios.suscriptor_id` con `cliente_id` nulable y `check (num_nonnulls(cliente_id, suscriptor_id) <= 1)`, `correo_masivo_pruebas.bloques/empresa_id`) |
| RPC del panel (`public`, `security definer`, `search_path = ''`) | `guardar_newsletter_configuracion`, `resumen_newsletter`, `listar_suscriptores_newsletter`, `dar_de_baja_suscriptor_newsletter`, `borrar_datos_suscriptor_newsletter`, `guardar_newsletter`, `descartar_newsletter`, `detalle_newsletter`, `vista_previa_newsletter`, `solicitar_prueba_newsletter`, `enviar_newsletter`, `cancelar_envio_newsletter`, `listar_newsletters` |
| Internas (`private`) | `exigir_admin_newsletter`, `armar_bloques_newsletter`, `escapar_html`, `cuerpo_html_newsletter`, `remitente_newsletter`; `reclamar_lote_correo_masivo` redefinida |
| Baja | `public.dar_de_baja_correo_masivo(hash)` (solo `service_role`) ahora resuelve también suscriptores; Edge Function `baja-correo-masivo` **sin cambios de contrato**; página `/newsletter/baja/:token` de la tienda |
| Kestra | `correo-masivo.yml` usa `cuerpo_html` y `remitente` cuando `tipo = 'newsletter'`; el correo de clientes sale idéntico |
| Panel | `Contactos → Newsletter` (`/clientes/newsletter`): `pages/clientes/newsletter/` (KPI, interruptor por tienda, suscriptores, campañas, `DialogoNuevaCampana`, `VistaPreviaNewsletter`), `lib/newsletter.ts`, `hooks/useRpcNewsletter.ts` |
| Pruebas | pgTAP `newsletter_baja`, `newsletter_gestion`, `newsletter_composicion`, `newsletter_envio`, `newsletter_lote`, `exportacion_total` extendido; Vitest de la pantalla, la lib, la página de baja y la lib pública; `test:kestra:correo-masivo` extendido |

### Reglas que importa recordar

- **Permisos (D6)**: ver (KPI, suscriptores, envíos, detalle) es lectura en `clientes`; componer, guardar, enviar, cancelar, dar de baja y borrar datos es **Administrador** con edición en `clientes` y acceso a la tienda, comprobado **dentro de cada RPC** (`42501`; otra organización `P0002`). La UI solo oculta.
- **Invariante de destinatarios (MSF-967)**: toda lista o conteo de destinatarios filtra `estado = 'confirmado'`, nunca `<> 'baja'`: `resumen_newsletter`, `vista_previa_newsletter`, la foto de `enviar_newsletter` y la re-verificación del reclamo. Un pendiente que conserva `baja_en` no recibe nada (cubierto por pgTAP en gestión, composición, envío y lote, y reunido en `newsletter_invariante_confirmado.test.sql`, que además comprueba que las cuatro funciones que eligen destinatarios usan `s.estado = 'confirmado'` y no `<> 'baja'` ni `in (...)`).
- **Sin carreras**: `enviar_newsletter` bloquea el newsletter (`for update`) y toma los confirmados con `for share`; el reclamo bloquea primero al suscriptor (`for share`) y luego al destinatario (`for update skip locked`), el mismo orden que la baja manual (suscriptor y luego destinatarios), así una baja, un borrado o una re-suscripción simultáneos esperan o se aplican antes de enviar sin interbloqueo. La clave de `enviar_newsletter` es la clave de la campaña (`unique (organizacion_id, clave)`): el doble clic devuelve la misma campaña; otra clave sobre un envío cerrado es `55000`.
- **Bandera y tienda**: con la bandera `newsletter` apagada las RPC de escritura responden `55000` y el reclamo del lote **no entrega nada del newsletter** (lo pendiente queda intacto y retoma al encenderla; las pruebas esperan). `enviar_newsletter` exige además el interruptor de la tienda (`22023` hint `tienda_apagada`) y un dominio activo (`sin_dominio`). La baja y el borrado de datos funcionan siempre. El reclamo vuelve a comprobar interruptor y tienda activa y omite lo pendiente si se apagaron.
- **Baja**: el enlace de cada correo lleva un token aleatorio por destinatario (solo se guarda su SHA-256 en `token_hashes`), apunta a `https://{dominio de la tienda}/newsletter/baja/{token}` y la página pide un clic (un visor de enlaces no da de baja a nadie). Responde siempre igual. **Borrar datos** deja el correo copiado en los envíos pasados como `[eliminado]`, omite lo pendiente y la FK compuesta suelta `suscriptor_id` (`on delete set null (suscriptor_id)`, sin anular la organización).
- **Contenido (D13)**: la «foto» (`bloques`) se arma al guardar la vista previa, al pedir la prueba y **al enviar** (no se guardan productos en el borrador): hasta 6 destacados y 6 promociones vigentes (la sección de promociones respeta la bandera `promociones_precio`), con el precio público de la tienda (`private.precio_vigente_empresa`) y el enlace a la ficha. Sin imágenes: el bucket de productos es privado y un correo no puede llevar una URL firmada de larga vida; `imagen_url` queda nulo (pendiente de decisión).
- **Un solo renderizado (desvío de RF-NL-15, RF-NL-21 y T023)**: el HTML del correo lo arma `private.cuerpo_html_newsletter` (todo texto escapado; enlaces solo `https://`; pie fijo). `vista_previa_newsletter` lo devuelve y el panel lo muestra en un `iframe sandbox=""`; el reclamo del lote lo entrega ya armado al flow, que lo muestra con `| raw` porque la base ya lo escapó. No hay una plantilla de React y otra de Kestra que puedan divergir; pgTAP cubre el escape y el pie con un valor exacto.
- **Remitente (D15)**: `"{tienda}" <KESTRA_SMTP_FROM>` con el nombre de la tienda saneado en la base (`private.remitente_newsletter`: sin comillas, `<`, `>`, `\` ni caracteres de control, ≤ 80), así un nombre de tienda no inyecta encabezados.
- **Cupo compartido (D14)**: el cupo diario por organización es uno solo entre clientes y newsletter, en orden de creación de la campaña: un newsletter grande retrasa los correos a clientes. Decidir si se separa el cupo (seguimiento del cierre).
- **Historiales**: `listar_campanas_correo` y `detalle_campana_correo` (clientes) solo muestran `tipo = 'clientes'`; el historial del newsletter es `listar_newsletters` / `detalle_newsletter`.
- **Eventos de Actividad** (sin correos, textos ni cuerpo): `newsletter.configurar`, `.guardar`, `.prueba`, `.enviar` (asunto y cantidad), `.cancelar`, `.baja_manual`, `.baja` (solo la primera vez), `.datos_borrados`; con etiquetas en `lib/actividad.ts`.
- **Cancelado no reenvía**: el reclamo trata como `omitido` («Cancelado») lo pendiente de una campaña cuyo newsletter tiene `cancelada_en`, aunque un reclamo vencido (flow cortado) lo hubiera devuelto a la cola.
- **Plantillas de Kestra (defensa en profundidad, no una garantía total)**: el flow muestra `cuerpo_html | raw`. `infra/kestra/compose.yaml` fija ahora `kestra.templating.recursive-rendering: false`; **hay que verificar en cada entorno** (dev, stg, prd) que la configuración efectiva lo respete, porque no se pudo comprobar contra un Kestra real. Capas que no dependen de eso: `private.escapar_html` convierte `{` y `}` del cuerpo en entidades (`&#123;` `&#125;`); el remitente pierde llaves, comillas, `<`, `>`, `\` y caracteres de control; el correo del suscriptor no admite llaves (validador, CHECK `newsletter_suscriptores_correo_llaves_ck` validado, y la migración `20270420000600` borra antes las filas viejas con llaves como «Borrar datos») y el reclamo omite («Correo inválido») a cualquier destinatario, de clientes o suscriptores, cuyo correo tenga `{` o `}`; en el caso de clientes el correo se vuelve a leer y filtrar en el bucle, justo antes de enviar, para que una edición concurrente de la ficha no cuele llaves. Una prueba cuyo correo (el del autor) tenga llaves no se pide ni se envía. **Siguen crudos** el `subject` (asunto escrito por el Administrador) y el `mensaje` del correo a clientes: provienen de quien tiene permiso de edición en Clientes y solo serían un riesgo con el renderizado recursivo activo.
- **Remitente**: `private.remitente_newsletter` quita comillas, `<`, `>`, llaves, barra invertida y caracteres de control.
- **Cancelar**: deja `omitido` (motivo «Cancelado») lo pendiente que no está reclamado en vuelo; lo reclamado se cierra solo y lo ya enviado no se retira.

### Desvíos respecto de la spec (declarados)

- La baja del suscriptor reutiliza el circuito del correo masivo (hash en `token_hashes` + Edge Function) tal como pide D3; el token lo emite el reclamo del lote (Fase 5), por lo que **no existe enlace de baja antes de que haya un envío**.
- `private.cerrar_envio_correo_masivo` no se redefine (no hace falta: cierra por id de destinatario o prueba).
- El reclamo devuelve `cuerpo_html`, `remitente`, `tienda` y `dominio_tienda` en lugar de `bloques` y `dominio` (el HTML ya viene armado; `dominio_tienda` evita chocar con el esquema `dominio`).
- `newsletter_lote.test.sql` es un archivo nuevo en lugar de extender `correo_masivo_lote.test.sql` (que sigue verde sin cambios: paridad de clientes).
- axe: el entorno de Vitest (jsdom) no tiene diseño ni contraste y no cambia de ancho: se corrió axe sobre la pantalla en un solo tamaño; los tres anchos (320/768/1440 px) los cubre `e2e/tienda-newsletter-a11y.e2e.ts` (MSF-961). Ese E2E encontró un `color-contrast` real: los mensajes de error del formulario salían en el rojo del tema (`.Mui-error` de `FormHelperText` le gana a un `color: inherit` suelto) sobre el pie oscuro; ahora heredan el color del pie (`ESTILO_ERROR_PIE`).

## Pendientes que requieren a Nicolás o a un entorno real

1. **Publicar el flow `correo-masivo` actualizado en Kestra** (`node infra/kestra/desplegar-flow.mjs --source infra/kestra/flows/correo-masivo.yml --namespace producto.clientes --flow-id correo-masivo --kestra-url …`) y, **antes de encender la bandera**, el flow `newsletter-confirmaciones` (ya mergeado en la Fase 2). Sin el flow nuevo, un newsletter se enviaría con la plantilla de clientes.
2. **SMTP real**: nada de esta entrega envía correo real en CI. Hay que probar en dev, con la bandera encendida y una tienda de prueba, una suscripción, la confirmación, una prueba y un envío a un suscriptor propio (T034) y mirar cómo llega (entregabilidad, enlace de baja).
3. **`List-Unsubscribe` / `List-Unsubscribe-Post` (D3, MSF-962)**: **verificado: `MailSend` de Kestra NO admite encabezados propios** (ver «Seguimientos de seguridad y entregabilidad»). Sin ellos la baja depende del enlace del cuerpo; los clientes de correo grandes lo piden para remitentes de volumen. Queda decidir el camino (propuesta abajo) con un SMTP real.
4. **Imágenes en el correo**: requieren decidir entre un bucket público de miniaturas o una URL firmada de larga vida (hoy `imagen_url` es nulo).
5. **Cupo compartido** entre clientes y newsletter (D14): decidir si se separan. La **alerta del tope global de confirmaciones** (MSF-971) ya existe; el CAPTCHA o el cupo por visitante siguen como propuesta.
6. **CAPTCHA** solo si hay abuso real: la alerta del tope es el disparador (ver propuesta).
7. **Rate limit en el borde de la baja** (MSF-980): **no se resuelve en el repo** (propuesta abajo): la Edge Function `baja-correo-masivo` es anónima y no limita por visitante; los tokens son de 244 bits y la respuesta es uniforme, así que el riesgo es de disponibilidad.

## Verificación técnica (T011)

- T011(a) `List-Unsubscribe`: verificado, el plugin no tiene la propiedad (MSF-962, abajo).
- T011(b) CORS de `baja-correo-masivo`: verificado y endurecido (MSF-963, abajo); contrato `{ token }` → `{ ok: true }` intacto.

## Seguimientos de seguridad y entregabilidad

Revisión del lote de deuda técnica MSF-515 (2026-11-17). Qué se comprobó en el repo, qué cambió y qué queda para un entorno real.

### `List-Unsubscribe` en el `MailSend` de Kestra (MSF-962)

- **Evidencia.** La tarea del flow `correo-masivo` es `io.kestra.plugin.notifications.mail.MailSend` (Kestra `v1.3.35`, `infra/kestra/compose.yaml`). Se leyó la documentación del plugin de correo de Kestra (página de `MailSend`, versión 1.6.9) y la fuente de `plugin-email` (`MailSend.java`): las únicas propiedades son `from`, `to`, `cc`, `bcc`, `subject`, `htmlTextContent`, `plainTextContent`, `attachments`, `embeddedImages`, `host`, `port`, `username`, `password`, `transportStrategy`, `sessionTimeout`, `verifyServerIdentity`, `trustedHosts`, `accessToken` y `assets`. **No hay ninguna para encabezados**: `List-Unsubscribe` y `List-Unsubscribe-Post` no se pueden agregar con esa tarea. La versión exacta del plugin que trae la imagen `v1.3.35` no se pudo inspeccionar desde el repo (no hay Kestra levantado acá), pero una versión anterior tiene aún menos propiedades.
- **No se cambió el flow** (solo el comentario que lo explica): reemplazar el envío no se puede probar sin Kestra y SMTP vivos.
- **Propuesta (para decidir con un SMTP real):**
  1. *Camino recomendado*: un relay SMTP que agregue los encabezados por su cuenta (Postmark, Amazon SES, Mailgun y similares los ofrecen en su plantilla o API), sin tocar el flow. Es lo más simple y lo que mejor cuida la entregabilidad.
  2. *Alternativa en el repo*: cambiar la tarea `enviar_correo` por una tarea de script de Kestra (`io.kestra.plugin.scripts.python.Script` con `smtplib` y `email.message.EmailMessage`, que sí permiten `msg['List-Unsubscribe'] = '<https://…>'`), conservando el reintento y el cierre del destinatario.
  3. *Requisito de cualquiera de las dos*: el `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) exige un `POST` a una URL `https` con cuerpo `application/x-www-form-urlencoded` (`List-Unsubscribe=One-Click`) y sin sesión. Hoy `baja-correo-masivo` solo acepta JSON `{ token }`: habría que sumarle el token por la URL (`?token=…`) y el cuerpo de formulario, sin tocar el contrato JSON. Con solo `List-Unsubscribe: <https://…/newsletter/baja/TOKEN>` (sin `-Post`) no hace falta tocar la función, pero Gmail y Yahoo piden el un clic para los envíos masivos.
- **Pendiente real**: elegir el camino y probarlo con SMTP real (entregabilidad). Hasta entonces la baja depende del enlace del cuerpo.

### CORS de `baja-correo-masivo` (MSF-963)

- **Verificado de nuevo en el lote 18 (2026-11-17)**: ya estaba resuelto en `dokploy` (commit `f53d71a10`); `node --test supabase/functions/baja-correo-masivo/handler.test.ts` da 9 de 9 y el contrato `{ token }` → `{ ok: true }` no cambió. No hubo cambios de código. Queda solo el pendiente por entorno de abajo.

- **Lo que se comprobó.** La página `/newsletter/baja/:token` corre en el dominio de cada tienda y llama con `supabaseClient.functions.invoke('baja-correo-masivo', { body: { token } })` (`apps/web/src/lib/tiendaNewsletter.ts`). El SDK instalado (`@supabase/supabase-js` 2.115.0, lockfile) manda `authorization`, `apikey`, `x-client-info` y `content-type`, y opcionalmente `x-retry-count`, `traceparent`, `tracestate` y `baggage` (lista oficial de `@supabase/supabase-js/cors`). La función ya respondía `Access-Control-Allow-Origin: *` con los cuatro primeros y con CORS en todas sus respuestas (200, 400, 405 y 500). `*` es lo correcto: los dominios de las tiendas son abiertos, la función no usa cookies ni credenciales y la autenticación es el token del enlace.
- **Lo que se cambió** (`supabase/functions/baja-correo-masivo/handler.ts`): se agregaron a los encabezados permitidos los opcionales del SDK (si alguna vez se activa la propagación de trazas, el preflight no rompería la baja), `Access-Control-Allow-Methods: POST, OPTIONS` y `Access-Control-Max-Age: 86400` solo en el preflight. Contrato intacto. `pnpm test:edge:baja-correo-masivo` (9 pruebas) cubre el preflight, CORS en todas las respuestas y el contrato.
- **Pendiente real (por entorno)**: confirmar en dev, stg y prd con `curl -i -X OPTIONS https://<supabase>/functions/v1/baja-correo-masivo -H 'Origin: https://<tienda>' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,apikey,x-client-info,content-type'` y un `POST` con la clave pública que el gateway no responda `401` antes de llegar a la función. `supabase/config.toml` **no** declara `[functions.baja-correo-masivo]`: por defecto el gateway exige `verify_jwt`, y una clave pública que no sea un JWT (publishable) terminaría en `401` sin cabeceras CORS (el navegador lo muestra como error de CORS). La baja de clientes (`/baja-correo/:token`) llama igual y funciona en dev, pero si algún entorno falla así, el arreglo es `[functions.baja-correo-masivo] verify_jwt = false` en el `config.toml` del workdir de ese entorno (mismo criterio que `consultar-estado-reparacion`, `docs/service-seguimiento.md`); no se agregó acá porque cambia la postura del gateway y no se pudo probar contra uno.

### Rate limit de la baja (MSF-980)

- **Decisión: no se implementa en el repo.** Un contador dentro de la función o de la base **empeora** el problema que se quiere evitar: el riesgo es de disponibilidad (los tokens son de 244 bits y la respuesta es siempre la misma, no hay enumeración), y un contador agrega una escritura a la base por cada pedido, justo la carga que un ataque busca provocar. Un contador en memoria de la función no sirve: cada instancia del runtime tiene el suyo y se reinician. El límite útil está **antes** de la función.
- **Propuesta concreta (infraestructura, fuera del repo):** limitar por IP la ruta `/functions/v1/baja-correo-masivo` en el borde de cada entorno.
  - *Con Cloudflare delante*: regla de límite de tasa sobre `http.request.uri.path eq "/functions/v1/baja-correo-masivo"` (30 pedidos por minuto y por IP, bloqueo de 10 minutos); una persona legítima hace uno o dos.
  - *Sin Cloudflare (Supabase self-hosted)*: en `kong.yml` del stack, una ruta propia para esa función con el plugin `rate-limiting` (`minute: 30`, `limit_by: ip`, `policy: local`), o `limit_req_zone`/`limit_req` de nginx en el proxy que atiende `/functions/v1/`.
  - Respuesta `429` con `Retry-After`: la página de baja ya muestra «Probá de nuevo en un rato» ante un error del servidor.
- **Pendiente**: aplicar la regla en cada entorno (dueño: Operaciones) y probarla con 40 pedidos seguidos desde una IP.

### Tope global de confirmaciones: alerta, CAPTCHA y cupo separado (MSF-971)

- **Hecho: alerta.** Migración `20270507110100_newsletter_alerta_tope_confirmaciones.sql`: cuando el tope global (200 por hora y tienda) descarta una alta legítima (nueva, o el reenvío de una dirección existente), `suscribirse_newsletter` registra un evento de Actividad `newsletter.tope_confirmaciones` (no sensible, **sin dirección ni IP**), a lo sumo **uno por hora y tienda** (la comprobación va bajo el lock por tienda que ya existía, así dos altas simultáneas no emiten dos). La respuesta al visitante no cambia (`ok` idéntico: sin señal de tope). Un fallo al registrar la alerta no rompe la alta. Se ve en Actividad con la etiqueta «Tope de confirmaciones por hora del newsletter alcanzado». pgTAP `newsletter_alerta_tope.test.sql`. Reversión: ver el encabezado de la migración.
- **Decisión: cupo separado por visitante no se agrega.** El cupo por visitante ya existe (5 por hora y visitante, `registrar_envio_tienda`); 40 visitantes a 5 por hora llenan el tope igual. Separar el cupo no distingue a quien reparte las altas entre muchas IP.
- **Propuesta para el CAPTCHA (solo con abuso real: la alerta es el disparador):** Cloudflare Turnstile (gratuito y sin pedir interacción en la mayoría de los casos): el formulario del pie suma el widget, una Edge Function nueva `suscribir-newsletter` valida el token con el secreto de Turnstile (`TURNSTILE_SECRET_KEY`, variable de la función) y recién ahí llama a `publico.suscribirse_newsletter` con la service-role; `anon` deja de ejecutar la RPC. Es infraestructura externa y un cambio de superficie pública: se decide cuando la alerta dispare con tráfico real. Alternativa más barata: subir el tope por tienda (hoy 200, `private.tope_confirmaciones_hora_newsletter()`) o hacerlo configurable.

## Reversión

Inmediata, sin código: `update public.banderas_plataforma set activa = false where clave = 'newsletter';` (el pie deja de mostrar el formulario y el
flow no envía). Migraciones posteriores (nunca en el mismo PR): `drop function` de las funciones de las migraciones `…0100` y `…0200`,
`drop table dominio.newsletter_suscriptores, dominio.newsletter_configuracion` (exportar antes los suscriptores si hace falta), borrar la fila de la
bandera, restaurar la definición de `private.conjuntos_exportacion_total()` vigente antes de las tablas del newsletter (la de `20270341000500` ya no es la vigente: hoy es `20270418000401`, o `20270349000200` antes de mover `clientes` a `dominio`; no pierdas ninguna fila posterior) y el check de `tienda_envios.origen` de
`20270321100000`.

Fases 3 a 5 (migraciones `20270420…`, nunca en el mismo PR): `drop function` de las RPC `newsletter` (`enviar_newsletter`, `cancelar_envio_newsletter`,
`listar_newsletters`, `vista_previa_newsletter`, `solicitar_prueba_newsletter`, `guardar_newsletter`, `descartar_newsletter`, `detalle_newsletter`,
`guardar_newsletter_configuracion`, `listar_suscriptores_newsletter`, `dar_de_baja_suscriptor_newsletter`, `borrar_datos_suscriptor_newsletter`) y de las
`private` (`armar_bloques_newsletter`, `cuerpo_html_newsletter`, `escapar_html`, `remitente_newsletter`, `exigir_admin_newsletter`); restaurar
`reclamar_lote_correo_masivo` (20270201200122), `dar_de_baja_correo_masivo`, `listar_campanas_correo` y `detalle_campana_correo` (20270201200123) y, con
`resumen_newsletter`, la definición de `20270420000000`; `alter table … drop column` de las columnas nuevas de las tres tablas del correo masivo (solo
tras borrar o migrar las filas `tipo = 'newsletter'`); `drop table dominio.newsletters`; restaurar `conjuntos_exportacion_total()` de `20270418000401` (sin la fila de `newsletters`); la migración `…0600` se revierte con `drop constraint newsletter_suscriptores_correo_llaves_ck` y el validador de `20270342000100`.
Desactivar sin revertir: apagar la bandera `newsletter` (el flow deja de enviar y lo pendiente queda intacto).
