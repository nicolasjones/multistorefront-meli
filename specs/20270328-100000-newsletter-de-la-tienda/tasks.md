# Tasks: Tiendas online · Newsletter (MSF-468)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) · Formato: `- [ ] T001 [P] [USy] descripción — evidencia`.
Cada RF/CA/SC tiene una tarea dueña y su verificación nombrada (tabla «Verificación por requisito» de `spec.md`). **Al cerrar cada fase ninguna tarea queda `[ ]`**: se hace con evidencia o se cierra con `Desvío: <motivo>` y un seguimiento trazado en el tracker. Se invoca `/speckit-implement` **fase por fase** con `/clear` entre una y otra.

## Matriz de trazabilidad (tracker ↔ US ↔ tasks)

| Tracker | Historia | US | RF / CA / SC dueños | Tareas |
|---|---|---|---|---|
| MSF-468 | Suscribirse y confirmar | US1 | RF-NL-1…6, CA-NL-1…5, SC-002 | T001–T012 |
| MSF-468 | Darse de baja | US2 | RF-NL-7…9, CA-NL-6 | T013–T015 |
| MSF-468 | Ver suscriptores y envíos | US4 | RF-NL-10…12, RF-NL-22…24, CA-NL-7, CA-NL-8, SC-003 | T013–T018 |
| MSF-468 | Componer y previsualizar | US3 | RF-NL-13…16, CA-NL-9 | T019–T024 |
| MSF-468 | Enviar y cancelar | US3 | RF-NL-17…21, CA-NL-10…12, SC-001, SC-004 | T025–T030 |
| Tarea de cierre (label cierre) | — | — | docs, seguridad, encendido y guards (RF-NL-25, RF-NL-26, CA-NL-11) | T031–T035 |

## Phase 1: Base de la suscripción (US1) — sin UI ni envíos

- [ ] T001 [US1] Migración `20270342000000_newsletter_suscripcion.sql`: bandera `newsletter` apagada, `dominio.newsletter_configuracion` y `dominio.newsletter_suscriptores` (checks de correo ≤ 254 sin `,` ni `;`, estado, índice único `(empresa_id, lower(correo))`, FK compuestas, RLS, grants por columna sin `confirmacion_hash`), check de `tienda_envios.origen` con `newsletter` (dueña de RF-NL-22). Evidencia: pgTAP `newsletter_suscripcion.test.sql` (estructura y grants).
- [ ] T002 [US1] Migración `20270342000100_newsletter_publico.sql`: `publico.newsletter_por_dominio`, `publico.suscribirse_newsletter` (validación, consentimiento, honeypot, límite HMAC `origen = 'newsletter'`, tope 3 por dirección y 24 h, reactivación desde baja, respuesta uniforme) y `publico.confirmar_newsletter` (RF-NL-1, 3, 5; D1, D2, D4). Evidencia: pgTAP `newsletter_suscripcion.test.sql` (no-enumeración, límite, `anon` solo `publico`).
- [ ] T003 [US1] Migración `20270342000200_newsletter_confirmaciones.sql`: `private.reclamar_confirmaciones_newsletter` (token nuevo, solo hash, vencimiento 48 h, reclamo con vencimiento, poda de `pendiente` > 7 días) y `private.cerrar_confirmacion_newsletter`; `execute` solo `kestra_orquestacion` (RF-NL-4, 6). Evidencia: pgTAP `newsletter_suscripcion.test.sql` (reclamo, reintento, poda).
- [ ] T004 [P] [US1] Bandera: pgTAP `newsletter_bandera.test.sql` (apagada: `newsletter_por_dominio` con `activo = false`, escrituras `55000`, `suscribirse` con `error` uniforme) (RF-NL-1, RF-NL-25).
- [ ] T005 [P] [US1] Aislamiento y seguridad: `newsletter_aislamiento.test.sql` (organizaciones y tiendas), `rls_en_toda_tabla` y `privilegios_anon_endurecidos` verdes con las tablas nuevas; extender `tienda_contacto.test.sql` (el origen `newsletter` comparte el cupo de 5/h) (RF-NL-22, SC-003).
- [ ] T006 [US1] Migración `20270342000300_exportacion_total_newsletter.sql` y prueba: las tablas entran a la exportación total sin `confirmacion_hash` (RF-NL-23). Evidencia: pgTAP `exportacion_total.test.sql` extendido.
- [ ] T007 [US1] Guards de la fase: `node scripts/verificar-migraciones.mjs --estricto`, `pnpm docs:check`, `pnpm der:check`, `pnpm test:db`. Evidencia: salida de cada comando.

**Checkpoint Fase 1**: la base acepta suscripciones, las confirma y las limita; ninguna pantalla, flow ni envío existe todavía y la bandera sigue apagada.

## Phase 2: Confirmación por correo y pie de la tienda (US1)

- [ ] T008 [US1] Flow `infra/kestra/flows/newsletter-confirmaciones.yml` (cada minuto; reclamar → enviar por el SMTP de Kestra con el nombre de la tienda → cerrar; 4 reintentos y motivo fijo) y variable `NEWSLETTER_CONFIRMACION_LOTE` en `infra/kestra/.env.example` (RF-NL-4). Evidencia: `pnpm test:kestra:newsletter-confirmaciones` y `pnpm infra:config`.
- [ ] T009 [US1] Formulario de suscripción en `PieTienda` (`pages/tienda-publica/newsletter/FormularioSuscripcion.tsx`, `lib/tiendaNewsletter.ts`, hook): correo, casilla, campo trampa oculto, clave por intento, estados y reintento (RF-NL-2, CA-NL-1). Evidencia: Vitest `FormularioSuscripcion.test.tsx` y axe a 320/768/1440 px.
- [ ] T010 [US1] Ruta y página `/newsletter/confirmar/:token` (éxito, vencido, inválido; ofrece volver al pie) (RF-NL-5, CA-NL-5). Evidencia: Vitest `confirmar-newsletter.test.tsx`.
- [ ] T011 [US1] Verificación técnica: (a) si el plugin `MailSend` de Kestra admite encabezados (`List-Unsubscribe` y `List-Unsubscribe-Post`, D3); si no, seguimiento trazado; (b) CORS de la Edge Function `baja-correo-masivo` para los dominios de las tiendas (RF-NL-9). Evidencia: nota en `docs/newsletter.md` y, si cambia, `pnpm test:edge:baja-correo-masivo`.
- [ ] T012 [US1] Guards de la fase (los de T007 más `pnpm ui:empresas:check`, `pnpm matriz:check`, `tsc -b`, lint). Evidencia: salida de cada comando.

**Checkpoint Fase 2**: con la bandera encendida en dev, un visitante se suscribe desde el pie y confirma por correo; todavía no hay baja ni envíos.

## Phase 3: Baja y gestión de suscriptores (US2, US4)

- [ ] T013 [US2] Migración `20270342000400_newsletter_baja_y_gestion.sql`: columnas nuevas de las tres tablas del correo masivo (`cliente_id` nulable con `check (num_nonnulls(cliente_id, suscriptor_id) <= 1)`, único `(campana_id, suscriptor_id)`), extensión de `dar_de_baja_correo_masivo` (suscriptor, pendientes `omitido`, evento una vez) y RPC `guardar_newsletter_configuracion`, `listar_suscriptores_newsletter`, `resumen_newsletter`, `dar_de_baja_suscriptor_newsletter`, `borrar_datos_suscriptor_newsletter` (RF-NL-8, 10, 12; D6, D17). Evidencia: pgTAP `newsletter_baja.test.sql`, `newsletter_gestion.test.sql` y `correo_masivo_campanas.test.sql` extendido (campañas de clientes sin cambios).
- [ ] T014 [P] [US2] Página `/newsletter/baja/:token` en la tienda (componente compartido con `/baja-correo/:token`; un botón, `ok` siempre) (RF-NL-7, CA-NL-6). Evidencia: Vitest `baja-newsletter.test.tsx` y `pnpm test:edge:baja-correo-masivo` sin cambios de contrato.
- [ ] T015 [US4] Pantalla `pages/clientes/newsletter/` (parte suscriptores): ruta lazy `/clientes/newsletter`, entrada «Newsletter» en Contactos con ícono de sobre con tilde, KPI, tabla de suscriptores con carga infinita y `FiltroEmpresa`, interruptor «Mostrar suscripción en el pie de la tienda», acciones «Dar de baja» y «Borrar datos» solo para Administrador (RF-NL-10…12, CA-NL-7). Evidencia: Vitest de la pantalla y axe.
- [ ] T016 [P] [US4] Fila «Empresa activa»: Vitest que cambia la empresa activa con la pantalla abierta (recarga KPI y tablas, reinicia la carga, descarta filtros inválidos) (matriz). Evidencia: `empresa-activa.test.tsx`.
- [ ] T017 [P] [US4] Etiquetas de los eventos `newsletter.*` en Actividad (sin datos personales) y ayuda de la pantalla (RF-NL-24). Evidencia: Vitest de Actividad y `ayuda-cobertura.test.ts`.
- [ ] T018 [US4] Guards de la fase (los de T012). Evidencia: salida de cada comando.

**Checkpoint Fase 3**: el visitante se da de baja con un clic y el administrador ve y gestiona suscriptores; aún no se compone ni se envía nada.

## Phase 4: Composición, vista previa y prueba (US3)

- [ ] T019 [US3] Migración `20270342000500_newsletters.sql`: `dominio.newsletters` (límites de nombre/asunto/mensaje, `version`, RLS, grants) y RPC `guardar_newsletter` (bloqueo optimista `40001`, `55000` si ya enviado), `descartar_newsletter`, `detalle_newsletter` (RF-NL-14; D10, D12). Evidencia: pgTAP `newsletter_composicion.test.sql`.
- [ ] T020 [US3] Migración `20270342000600_newsletter_bloques_y_prueba.sql`: `private.armar_bloques_newsletter` (destacados y promociones vigentes, hasta 6 cada una, respeta bandera `promociones_precio`, mismo precio público de la tienda, enlace a la ficha), `vista_previa_newsletter` y `solicitar_prueba_newsletter` con el tope de 5/h (RF-NL-15, 16; D13, D18). Evidencia: pgTAP `newsletter_composicion.test.sql` (foto, límites, secciones vacías).
- [ ] T021 [US3] UI: `DialogoNuevaCampana` (campos del prototipo + dos interruptores), `VistaPreviaNewsletter` (mensaje escapado, secciones, pie fijo con baja de ejemplo, «Precios al día»), «Enviar prueba», «Guardar borrador», `lib/newsletter.ts` con los mismos límites que la base (RF-NL-13…16, CA-NL-9). Evidencia: Vitest del diálogo y de la vista previa, axe.
- [ ] T022 [P] [US3] Empresa activa del diálogo: se cierra con aviso al cambiar de empresa y no guarda con la anterior; «Tienda remitente» solo con tiendas accesibles (matriz, CA-NL-8). Evidencia: Vitest.
- [ ] T023 [P] [US3] Paridad de render: test que compara la estructura de la vista previa y la plantilla del flow para un mismo `bloques` (riesgo de dos renderizados). Evidencia: `lib/newsletter.test.ts` y `test:kestra:correo-masivo`.
- [ ] T024 [US3] Guards de la fase (los de T012). Evidencia: salida de cada comando.

**Checkpoint Fase 4**: el administrador compone, guarda borradores, ve la vista previa y se manda una prueba; el botón «Enviar» todavía no existe.

## Phase 5: Envío por el motor del correo masivo (US3)

- [ ] T025 [US3] Migración `20270342000700_newsletter_envio.sql`: `enviar_newsletter` (Administrador, `22023` `sin_destinatarios`, foto del contenido y de los `confirmado`, campaña `tipo = 'newsletter'`, clave idempotente), `cancelar_envio_newsletter` y `listar_newsletters` con estados y totales (RF-NL-17…19). Evidencia: pgTAP `newsletter_envio.test.sql`.
- [ ] T026 [US3] Migración `20270342000800_newsletter_lote.sql`: redefine `reclamar_lote_correo_masivo` (re-verifica `confirmado`, bandera y tienda; devuelve `tipo`, `bloques`, tienda y dominio; mismo cupo), `cerrar_envio_correo_masivo` y el historial de clientes (solo `tipo = 'clientes'`) (RF-NL-20, SC-004; D14). Evidencia: pgTAP `correo_masivo_lote.test.sql` extendido (suscriptor, cupo compartido, paridad con clientes).
- [ ] T027 [US3] Flow `correo-masivo.yml`: plantilla del newsletter con la foto (mensaje escapado, secciones), remitente con el nombre de la tienda, pie y enlace de baja al dominio de la tienda; los correos de clientes salen idénticos (RF-NL-21). Evidencia: `pnpm test:kestra:correo-masivo` y `pnpm infra:config`.
- [ ] T028 [US3] UI: «Enviar a N» con confirmación y clave, «Cancelar envío», tabla de envíos con estados (Borrador, Enviando, Enviada, Cancelada) y totales, sin «Aperturas» (RF-NL-17…19, CA-NL-10, CA-NL-12). Evidencia: Vitest.
- [ ] T029 [P] [US3] Aislamiento del envío: otra organización o tienda no accesible no puede enviar ni cancelar; un envío ya enviado no se edita (CA-NL-8, CA-NL-12). Evidencia: pgTAP `newsletter_aislamiento.test.sql`.
- [ ] T030 [US3] Guards de la fase (los de T012). Evidencia: salida de cada comando.

**Checkpoint Fase 5**: un administrador envía un newsletter de punta a punta en dev y los destinatarios lo reciben con su baja; con la bandera apagada, el correo a clientes sigue idéntico.

## Phase 6: Cierre

- [ ] T031 Documentación: `docs/newsletter.md` (nuevo, con `owner` y `sources`; entrada en `mkdocs.yml`), notas en `docs/correo-masivo.md`, `docs/tienda-contacto.md` y `docs/deployment.md` (bandera, pasos manuales), `docs/roadmap-template.md` y `AGENTS.md`/`CLAUDE.md` si cambian reglas. Evidencia: `pnpm docs:check`.
- [ ] T032 E2E `apps/web/e2e/tienda-newsletter.e2e.ts`: suscribir, confirmar, componer, enviar a un suscriptor de prueba, baja (CA-NL-1…CA-NL-6, CA-NL-9…CA-NL-12). Evidencia: corrida local con el stack y CI `e2e-tienda`.
- [ ] T033 Revisión de seguridad con `authz-security` y `crypto-secrets` sobre las migraciones, las RPC `publico`, la baja y los flows; hallazgos menores se arreglan siempre. Evidencia: informe en el PR y `docs/newsletter.md`.
- [ ] T034 Encendido y verificación en dev (no por migración): `update public.banderas_plataforma set activa = true where clave = 'newsletter'` y activar el interruptor de una tienda de prueba; verificar el bundle y la tienda de dev (suscripción real, confirmación, envío de prueba). Evidencia: capturas y consulta SQL en la nota de cierre.
- [ ] T035 Guards finales y seguimientos trazados: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm der:check`, `pnpm matriz:check`, `pnpm prototipo:check`; abrir seguimientos (CAPTCHA si hay abuso, `List-Unsubscribe` si T011 lo difirió, cupo separado de newsletter, selector manual de productos, «responder a» por tienda). Evidencia: salida de cada comando y enlaces a los seguimientos.

**Checkpoint final**: todas las tareas hechas o cerradas con desvío y seguimiento trazado; bandera apagada por defecto en prd hasta decisión de Nicolás.
