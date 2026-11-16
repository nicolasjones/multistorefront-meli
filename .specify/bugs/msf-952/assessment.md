# Bug Assessment: Envío automático de WhatsApp con proveedor de mensajería (seguimiento S-1 de MSF-118)

- **Slug**: msf-952 (provisto por el usuario)
- **Created**: 2026-11-15
- **Source**: pasted text — «Seguimiento MSF-118 · S-1 Envío automático de WhatsApp con proveedor de mensajería (It's a Plan MSF-952) slug=msf-952». Sin URL: no hay enlace que traer, así que no aplica la URL Trust Policy (no se consultó Jira ni ningún tracker).
- **Verdict**: valid (brecha funcional deliberadamente diferida y trazada; no es una regresión de código)
- **Severity**: medium

## Report (verbatim or summarized)

«Seguimiento MSF-118 · S-1 Envío automático de WhatsApp con proveedor de mensajería (It's a Plan MSF-952)».

Es el seguimiento **S-1** declarado por la épica MSF-118 (spec `20270323-100000-service-ideas-futuras-v2`):

> `specs/20270323-100000-service-ideas-futuras-v2/spec.md:305` — «**Seguimientos trazados al implementar** (Tarea `seguimiento` en el tracker): **S-1** envío automático por WhatsApp con proveedor (flow de Kestra análogo a `reparaciones-aviso-correo`, `canal = 'whatsapp'`, estados `pendiente → enviado/fallido`, plantillas aprobadas y consentimiento); …»

## Symptom

El taller no puede **avisar al cliente por WhatsApp de forma automática desde el servidor**: no hay ningún cliente de proveedor de mensajería, ni flow, ni credenciales, ni plantillas, ni consentimiento ni estado de envío por WhatsApp. Lo único que existe hoy es «click-to-chat»: el panel arma un enlace `wa.me` y **la persona lo abre en su navegador** (`apps/web/src/lib/whatsapp.ts:60-64`); el servidor no manda nada. Esperado por el seguimiento S-1: que la plataforma envíe sola la notificación de estado de la reparación al celular del cliente, con los estados `pendiente → enviado/fallido` registrados en el historial de avisos.

## Reproduction

1. Abrir una reparación en `/service-tecnico/reparaciones/:id` y la sección «Avisos al cliente».
2. Observar que el único canal es **correo**: el botón pide «Avisar al cliente» y el historial muestra «Pendiente / Enviado / Fallido» (`apps/web/src/lib/reparacionAvisos.ts:7`, `docs/service-avisos.md:17`).
3. Buscar en todo el repo un cliente de proveedor de mensajería (Twilio, Meta Cloud API, 360dialog, wablas, `api.whatsapp.com`): **no existe ninguno**; tampoco hay variables de entorno de proveedor en ningún `.env.example` ni en `infra/kestra/compose.yaml`.
4. Confirmar en la base que el modelo no tiene canal: `dominio.reparacion_avisos.estado_envio` solo admite `('pendiente','enviado','fallido')` y **no tiene columna `canal`** (`supabase/migrations/20270201200133_reparacion_avisos.sql:26`); no existe `public.registrar_aviso_whatsapp` ni `public.datos_aviso_whatsapp`.

[NEEDS CLARIFICATION: no hay repro del tracker (solo el título del ticket): los pasos de arriba son la verificación de ausencia en el código, no una falla observada por un usuario.]

## Suspected Code Paths

### Lo que existe hoy (el camino análogo, por correo)

- `supabase/migrations/20270201200133_reparacion_avisos.sql:15-45` — tabla `dominio.reparacion_avisos`: `destinatario` (correo, `:25`), `estado_envio text not null default 'pendiente' check (estado_envio in ('pendiente','enviado','fallido'))` (`:26`), `check` de coherencia enviado/`enviado_en` (`:41-44`), índice único parcial `reparacion_avisos_pendiente_uq` sobre `(reparacion_id, estado_id) where estado_envio = 'pendiente'` (`:53-55`), RLS por organización + `service_tecnico` + tienda accesible (`:69-75`), `grant select` sin `destinatario` (`:77-81`). **Sin columna `canal` ni `clave_envio`.**
- `supabase/migrations/20270201200134_avisar_cliente_reparacion.sql:24-125` — RPC `public.avisar_cliente_reparacion`: valida `edicion` (`:41-44`), `P0002`/`55000`/`22023` (`:45-66`), `sin_correo` si el cliente no tiene correo (`:68-76`), exige la conexión `comprobantes-pdf` (`:88-96`) y encola en la outbox (`capacidades_ejecucion` / `ejecuciones_worker` / `despachos_ejecucion`, `:98-113`).
- `supabase/migrations/20270201200136_avisos_reparacion_flow.sql:25-166` — funciones `private` del flow: `datos_aviso_reparacion` (`exigir_llamante_kestra`, `:34`), `aplicar_cierre_aviso_reparacion` (idempotente, `:87-89`; `enviado` `:95-102`; `fallido` con motivo sanitizado `:104-115`), `cerrar_aviso_reparacion` (solo Kestra, `:126-137`), `expirar_avisos_reparacion` (pendiente > 15 min → fallido, `:141-166`).
- `infra/kestra/flows/reparaciones-aviso-correo.yml:17-123` — flow `reparaciones-aviso-correo` (namespace `producto.service`): reclama `enviar-aviso-reparacion-` (`:31`), resuelve datos (`:47-52`), `MailSend` con `KESTRA_SMTP_*` y 3 reintentos (`:53-74`), cierra como enviado (`:75-83`), error handler que cierra como fallido con motivo fijo (`:93-112`), cron cada minuto (`:113-116`).
- `docs/service-avisos.md:19-94` — guía del flujo de avisos por correo (modelo, RPC, flow, plantilla, pruebas, reversión). **No menciona S-1, ni proveedor, ni plantillas, ni consentimiento.**

### Lo que falta (el objeto de S-1)

- `specs/20270323-100000-service-ideas-futuras-v2/spec.md:278` — D-1 decide explícitamente **no** contratar proveedor: «*Descartado*: WhatsApp Business Cloud API / Twilio: requiere contratar proveedor, plantillas aprobadas por Meta, consentimiento explícito y tiene costo por conversación; es un seguimiento (S-1), no una dependencia de esta épica».
- `specs/20270323-100000-service-ideas-futuras-v2/spec.md:17` y `:564` — «Envío automático de WhatsApp desde el servidor …: seguimiento S-1» fuera de alcance.
- `specs/20270323-100000-service-ideas-futuras-v2/spec.md:322` — FR-010 prohíbe explícitamente enviar: «El sistema NO DEBE enviar mensajes de WhatsApp ni llamar a un servicio de mensajería: no hay flow, worker, función Edge ni credenciales nuevas».
- `specs/20270323-100000-service-ideas-futuras-v2/spec.md:279` — D-2 deja preparado el modelo para el día del proveedor: «con `canal` el día que haya proveedor el mismo modelo sirve (estados `pendiente → enviado/fallido`)» → **dependencia dura de F-SVC-30/FR-002**.
- `specs/20270323-100000-service-ideas-futuras-v2/tasks.md:87` — T029 «Seguimientos trazados (Tarea `seguimiento` en el tracker, con su clave anotada en `docs/service-avisos.md`): **S-1** envío automático por WhatsApp con proveedor y **S-4** plantillas por empresa» → **la clave de S-1 todavía no está anotada** en `docs/service-avisos.md` (no aparece S-1, «proveedor» ni «plantillas» en el archivo).
- Ausencia total de cliente de proveedor: búsqueda en todo el repo de `twilio`, `360dialog`, `wablas`, `api.whatsapp.com`, `whatsapp_business`, `wa_id`, `SENDER_ID`, `proveedor de mensajer*` → **solo** la frase de D-1 en la spec y los patrones genéricos de detección de secretos de la skill `crypto-secrets` (`.claude/skills/crypto-secrets/references/secrets-patterns.yaml:178-185`). No hay cliente HTTP, SDK, worker, Edge Function ni SQL que hable con un proveedor.
- Ausencia de credenciales: `infra/kestra/.env.example:38-47` solo tiene `KESTRA_SMTP_*`; `infra/kestra/compose.yaml` no lista ninguna variable de mensajería; ningún `.env.example` del repo tiene `WHATSAPP_*`, `TWILIO_*`, `META_*`, `360DIALOG_*` o `SENDER_ID`.
- Ausencia de consentimiento para WhatsApp: el único consentimiento de clientes es `public.clientes.acepta_correo_masivo` (solo correo masivo; `supabase/migrations/20270201200119_clientes_acepta_correo_masivo.sql:25-32`) y el de la libreta `dominio.contactos.consentimiento_*` (`supabase/migrations/20270201100000_contactos.sql:32-35`). No hay campo de consentimiento ni de baja para WhatsApp.
- Ausencia de plantillas: no hay ninguna tabla de plantillas de WhatsApp (ni de mensaje por empresa, que es S-4); la única plantilla es el asunto/cuerpo fijo del flow de correo (`infra/kestra/flows/reparaciones-aviso-correo.yml:63-70`).

### El orden de trabajo (dependencia)

- **F-SVC-30 (el «click-to-chat») todavía no está implementado en este worktree ni en ninguna rama**: `specs/20270323-100000-service-ideas-futuras-v2/tasks.md` tiene 61 tareas `[ ]` y 0 `[x]` (`tasks.md:7` lo dice: «ninguna historia implementada»); no existen `apps/web/src/lib/avisoWhatsapp.ts`, `apps/web/src/components/service/AvisoWhatsappDialog.tsx`, las migraciones `20270323100000…100200` ni las RPC `datos_aviso_whatsapp` / `registrar_aviso_whatsapp` (`git log --all -- '*avisoWhatsapp*'` vacío; no hay rama `feat/MSF-181-aviso-whatsapp`).

## Root Cause Hypothesis

No es un defecto introducido ni una regresión: la épica MSF-118 decidió por diseño (D-1) no depender de un proveedor de mensajería porque implica contratarlo, tener plantillas aprobadas por Meta, consentimiento explícito y costo por conversación, y lo dejó trazado como **seguimiento S-1** (`spec.md:305`). En el código **no existe ninguna pieza** de ese envío automático —ni cliente del proveedor, ni flow, ni credenciales, ni plantillas, ni consentimiento, ni el estado `canal`/`pendiente → enviado/fallido` para WhatsApp— porque la tabla de avisos solo modela el canal de correo (`20270201200133_reparacion_avisos.sql:26`) y el envío real lo hace un flow de Kestra con SMTP (`reparaciones-aviso-correo.yml:53-74`). Hay además una **dependencia de orden no resuelta**: S-1 está diseñado para apoyarse en el modelo `canal` + estado `abierto` que introduces F-SVC-30 (D-2, FR-002, `spec.md:279`/`:314`), y F-SVC-30 no está implementada; la tarea que debía registrar la clave de S-1 en las docs (T029) sigue `[ ]`. Confianza: alta (todo es verificable en el árbol; no hay nada que "falte" por error).

## Proposed Remediation

**Preferred**: tratarlo como **funcionalidad nueva con Spec Kit** (no como hotfix), porque el repo exige spec propia para capacidades nuevas (`AGENTS.md`: «Para una funcionalidad nueva, usa el flujo GitHub Spec Kit ya versionado»). Alcance de entrega esperado: `supabase` + `kestra` + `refine` (+ `workers` solo si el proveedor se llama desde un worker). Diseño esperado:

1. **Depender de F-SVC-30** (o, si se decide no implementarla, declarar aquí el `canal`/`clave_envio`): una sola columna `canal text not null default 'correo' check (canal in ('correo','whatsapp'))` sobre `dominio.reparacion_avisos`, con los estados `pendiente → enviado/fallido` para `canal = 'whatsapp'`. **Ojo con el índice único parcial `reparacion_avisos_pendiente_uq`** (`20270201200133:53-55`): un aviso de WhatsApp `pendiente` bloquearía el aviso de correo del mismo estado; el `check` de coherencia de FR-002 (`spec.md:314`) tiene que resolverlo.
2. **Outbox + flow, no SQL HTTP**: la RPC encola (`public.capacidades_ejecucion` / `ejecuciones_worker` / `despachos_ejecucion`, como `avisar_cliente_reparacion`) y un flow nuevo `infra/kestra/flows/reparaciones-aviso-whatsapp.yml` análogo a `reparaciones-aviso-correo.yml` hace el envío, el cierre idempotente y la expiración a los 15 minutos. La llamada al proveedor va en el flow (tarea HTTP de Kestra) o en una Edge Function con secreto compartido invocada por el flow — el patrón ya existente en `infra/kestra/flows/avisos-faltantes.yml` + `supabase/functions/enviar-aviso-faltante/handler.ts`; **nunca** `http_get`/`http_post` en migraciones (`scripts/verificar-frontera-outbox.mjs`).
3. **Consentimiento**: columna nueva de consentimiento del cliente (patrón `public.clientes.acepta_correo_masivo`, `20270201200119:25-32`) + baja pública con token hasheado (patrón `public.dar_de_baja_correo_masivo`, `20270201200122_campanas_correo_lote.sql:169-206` + `supabase/functions/baja-correo-masivo/`). Sin consentimiento, el aviso no se encola.
4. **Plantillas**: plantilla fija y transaccional aprobada por Meta (las plantillas por empresa son S-4, **fuera** de este seguimiento) + el cuerpo ya definido por F-SVC-30/FR-005.
5. **Costo**: cuota diaria por organización (patrón `private.reclamar_lote_correo_masivo`, `20270201200122:30`) y registro del costo/conversación para poder rendirlo.
6. **Secretos**: `SECRET_<PROVEEDOR>_*` base64 en `infra/kestra/.env` (nunca en Git) y solo el placeholder en `infra/kestra/.env.example`; nunca en el navegador.

**Alternatives**:
- **Cerrar S-1 como «no se va a hacer»**: dejar el click-to-chat y documentar la decisión (cero costo, cero datos personales nuevos, cero dependencia externa). Es defendible si el taller no quiere pagar conversaciones ni gestionar plantillas aprobadas.
- **Envío manual asistido** (abrir el panel del proveedor con el mensaje copiado): sin código, pero sin trazabilidad ni estados `pendiente → enviado/fallido`; no satisface la definición de S-1.

**Files likely to change** (orientativo; la numeración de migraciones se ajusta con `node scripts/verificar-migraciones.mjs`):
- `supabase/migrations/<nueva>_reparacion_avisos_whatsapp_envio.sql` — columna `canal`, estados, `check` de coherencia, índice, `grant select` (aditiva, con reversión en el encabezado)
- `supabase/migrations/<nueva>_avisos_whatsapp_envio_flow.sql` — funciones `private` del flow (solo `kestra_orquestacion`)
- `supabase/migrations/<nueva>_consentimiento_whatsapp_clientes.sql` — consentimiento y baja
- `infra/kestra/flows/reparaciones-aviso-whatsapp.yml` (+ `.test.mjs`) y `infra/kestra/.env.example` / `infra/kestra/compose.yaml`
- `supabase/functions/enviar-aviso-whatsapp/{index,handler}.ts` — solo si el proveedor se llama desde una Edge Function
- `apps/web/src/lib/reparacionAvisos.ts`, `apps/web/src/components/service/AvisosReparacion.tsx` — columna `canal` en el historial y acción «Enviar por WhatsApp»
- `docs/service-avisos.md`, `docs/actividad.md`, `docs/roadmap-template.md` y `specs/<nueva>/{spec,plan,tasks}.md`

**Tests to add or update**:
- pgTAP: `canal`/`estado_envio` y sus `check`s; un aviso de WhatsApp `pendiente` no bloquea el aviso de correo; no se encola sin consentimiento; destino con `^[0-9]{8,15}$`; idempotencia; aislamiento por organización y tienda; `anon` sin `execute`; `rls_en_toda_tabla` verde.
- pgTAP del flow: `pendiente → enviado/fallido`, idempotencia del cierre, expiración a los 15 minutos, motivo de fallo sanitizado (nunca credenciales del proveedor).
- Test estático del flow (análogo a `infra/kestra/flows/reparaciones-aviso-correo.test.mjs`): capacidad reclamada, `SECRET_*` usados, plantilla sin importes ni costos, reintentos acotados.
- Vitest: historial por canal, botón solo con `edicion`, error de envío con texto exacto, cambio de empresa activa, y que **no** haya regresión del aviso por correo.
- Test del cliente del proveedor (si es Edge Function): sin sesión, token inválido, error 4xx/5xx del proveedor mapeado a `fallido`, y que el token nunca se registre.

## Risks & Considerations

- **Es una funcionalidad nueva, no un bug**: por `AGENTS.md` va por Spec Kit (`speckit-specify` → `plan` → `tasks`), con PR contra `main` al crear la rama; no se parchea el código actual.
- **Orden**: S-1 depende del modelo `canal` de F-SVC-30 (D-2/FR-002). Implementarlo antes genera **dos modelos de WhatsApp** (filas `abierto` de click-to-chat y filas `pendiente/enviado/fallido` de proveedor) y una migración conflictiva. Recomendación: S-1 espera a F-SVC-30.
- **Restricción de FR-010**: mientras F-SVC-30 no aterrice, el diff de S-1 no puede tocar a la vez `infra/`, `workers/` ni `supabase/functions/` sin violar la `[REV]` T033 de la historia previa (`tasks.md:91`).
- **Proveedor y costo**: Meta exige plantillas aprobadas fuera de la ventana de atención (24 h) y cobra por conversación; es una decisión de negocio (qué proveedor, qué presupuesto, quién paga) que el repo no puede inventar. Sin esa decisión, la implementación no puede cerrarse.
- **Datos personales y consentimiento**: el teléfono del cliente y el texto del mensaje son PII; el consentimiento y la baja tienen que existir **antes** del primer envío, y la actividad (`registro_actividad`) no debe llevar el número (mismo criterio de la amenaza 1.8 de MSF-118).
- **Entrega «al menos una vez»**: el patrón actual admite que un corte entre enviar y cerrar reenvíe (`docs/service-avisos.md:66-69`); con un proveedor esto es un mensaje duplicado al cliente. Usar la idempotencia del proveedor y el `clave_envio` como clave de idempotencia.
- **Frontera de outbox**: `scripts/verificar-frontera-outbox.mjs` rechaza `http_get`/`http_post`/webhooks en migraciones: el proveedor se llama desde el flow o desde una Edge Function, nunca desde SQL.
- **Secretos**: credenciales solo en `infra/kestra/.env` (base64, `SECRET_*`) y `.env.example` con placeholders; nunca en el navegador ni en Git; el motivo de fallo guardado en `reparacion_avisos.error` debe seguir el mismo saneado de `20270201200136:77-81`.
- **Documentación**: `pnpm docs:check` (incluye `verificar-migraciones.mjs`), `pnpm der:check` (la spec nueva toca tablas y necesita el DER completo) y `pnpm matriz:check` si hay UI nueva.
- **Observación lateral (no es la causa)**: `docs/service-avisos.md:37-40` lista cuatro migraciones (`20270121120600…120900`) que **no existen** en el repo (los archivos reales son `20270201200133…136`); mismo desvío en `docs/correo-masivo.md:48`. Si S-1 escribe en esa guía, no debe repetir el desvío.

## Open Questions

- [NEEDS CLARIFICATION: ¿qué proveedor se contrata (Meta Cloud API, Twilio, 360dialog, otro) y quién lo contrata: el cliente o la plataforma?]
- [NEEDS CLARIFICATION: ¿qué plantillas quedan aprobadas por Meta y el mensaje es transaccional (dentro de la ventana de atención) o necesita plantilla preaprobada?]
- [NEEDS CLARIFICATION: ¿cómo se recoge el consentimiento (en la recepción del equipo, en la ficha del cliente, con enlace de baja) y se aplica a los clientes ya cargados?]
- [NEEDS CLARIFICATION: ¿qué presupuesto/cuota de conversaciones por organización y quién asume el costo?]
- [NEEDS CLARIFICATION: ¿S-1 espera a F-SVC-30 (reusar `canal`/`abierto`) o se decide que S-1 reemplaza el click-to-chat y se implementa solo?]
- [NEEDS CLARIFICATION: ¿el envío automático convive con el botón «Abrir WhatsApp» o lo reemplaza en el historial de avisos?]
- [NEEDS CLARIFICATION: ¿la clave de S-1 (MSF-952) debe anotarse ya en `docs/service-avisos.md`, aunque F-SVC-30 todavía no exista (T029 sigue `[ ]`)?]
