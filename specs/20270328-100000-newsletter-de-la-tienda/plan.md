# Plan: Tiendas online · Newsletter (MSF-468)

**Spec**: [`spec.md`](./spec.md) · **Estado**: spec redactada, sin implementar. Decisión de Nicolás (2026-11-15): formulario de suscripción en el pie con baja personal que alimenta el correo masivo (MSF-155) y **el dueño compone cada envío** con vista previa; el resto son decisiones delegadas D1–D18 de la spec.

## Enfoque

- **Dos listas, un motor**: el newsletter tiene sus propios suscriptores (`dominio.newsletter_suscriptores`, consentimiento propio) pero **envía por el motor de MSF-155** (campaña, destinatarios, cupo diario, reclamo con vencimiento, baja por hash, SMTP de Kestra). No hay un segundo proveedor ni un segundo circuito de baja.
- **La suscripción es lo único anónimo**: tres funciones `publico` (como el contacto de MSF-212) con el límite por visitante HMAC existente, double opt-in y respuestas uniformes. Todo lo demás es del panel y pasa por RPC `security definer` con rol Administrador comprobado adentro.
- **Composición mínima**: asunto, texto plano y dos secciones con interruptor (destacados y promociones) que el sistema arma desde el catálogo. El contenido se **congela al enviar** (`bloques`) y vista previa, prueba y correo salen de la misma foto.
- **Apagable**: bandera `newsletter` (apagada) + interruptor por tienda (apagado). Baja y borrado de datos funcionan siempre.
- **Orden por riesgo**: (1) base y RPC públicas sin UI ni envíos; (2) confirmación por correo y pie de la tienda; (3) baja y gestión de suscriptores; (4) composición (sin envío); (5) envío real por el motor; (6) cierre y encendido. Cada fase se mergea y se verifica sola; **el único cambio sobre lo existente (correo masivo a clientes) está en la fase 5**, detrás de la bandera y con pgTAP de paridad.
- **UI mínima declarada**: el prototipo trae la pantalla del panel; el pie, la confirmación y la baja públicas no están dibujados (decisión declarada en la matriz).

## Esquemas (Principio VII, re-verificado en spec, plan y tareas)

Ver la tabla «Esquema de datos» de la spec: tablas nuevas y alteradas en `dominio`; RPC del panel en `public`; RPC anónimas en `publico`; lógica interna en `private`; bandera en `public.banderas_plataforma`.

## Migraciones (todas aditivas e idempotentes; reversión en el encabezado de cada una)

Numeración **por encima de toda la cola de `dokploy`**: la máxima cambia con cada merge (`node scripts/verificar-migraciones.mjs --estricto`; al 2026-11-15 la siguiente ventana libre empieza en `20270350…`); se usa la ventana `20270342000000+` y se **renumera al integrar** si otra rama la ocupó.

| Migración | Fase | Contenido |
|---|---|---|
| `20270342000000_newsletter_suscripcion.sql` | 1 | Bandera `newsletter` apagada, `dominio.newsletter_configuracion` y `dominio.newsletter_suscriptores` (checks, índice único `(empresa_id, lower(correo))`, RLS, grants por columna sin `confirmacion_hash`), `tienda_envios.origen` suma `newsletter` |
| `20270342000100_newsletter_publico.sql` | 1 | `publico.newsletter_por_dominio`, `publico.suscribirse_newsletter`, `publico.confirmar_newsletter`, `private.validar_suscripcion_newsletter` (revoke a `public`/`authenticated`; `anon` solo ejecuta las tres `publico`) |
| `20270342000200_newsletter_confirmaciones.sql` | 1 | `private.reclamar_confirmaciones_newsletter` (token nuevo, hash, vencimiento 48 h, poda de `pendiente` > 7 días), `private.cerrar_confirmacion_newsletter`; `execute` solo para `kestra_orquestacion` |
| `20270342000300_exportacion_total_newsletter.sql` | 1 | Las tres tablas entran a `private.exclusiones_exportacion_total()` (rebasar si otra migración posterior a `20270324100300` la redefine) |
| `20270342000400_newsletter_baja_y_gestion.sql` | 3 | Columnas nuevas de `campanas_correo` (`tipo`, `newsletter_id`, `bloques`), `campana_correo_destinatarios` (`cliente_id` nulable, `suscriptor_id`, checks y único) y `correo_masivo_pruebas` (`bloques`, `empresa_id`); extensión de `dar_de_baja_correo_masivo`; RPC `guardar_newsletter_configuracion`, `listar_suscriptores_newsletter`, `resumen_newsletter`, `dar_de_baja_suscriptor_newsletter`, `borrar_datos_suscriptor_newsletter` |
| `20270342000500_newsletters.sql` | 4 | `dominio.newsletters` (RLS, grants), RPC `guardar_newsletter`, `descartar_newsletter`, `detalle_newsletter` |
| `20270342000600_newsletter_bloques_y_prueba.sql` | 4 | `private.armar_bloques_newsletter`, `vista_previa_newsletter`, `solicitar_prueba_newsletter` |
| `20270342000700_newsletter_envio.sql` | 5 | `enviar_newsletter`, `cancelar_envio_newsletter`, `listar_newsletters` |
| `20270342000800_newsletter_lote.sql` | 5 | Redefine `private.reclamar_lote_correo_masivo`, `private.cerrar_envio_correo_masivo`, `listar_campanas_correo` y `detalle_campana_correo` (mismas firmas; solo campañas `clientes`; columnas nuevas al final) |

La última migración de cada fase deja la reversión **documentada** (no ejecutada en el mismo PR): restaurar las funciones redefinidas a su cuerpo anterior (`20270201200122`, `20270201200123` y la de baja de `20270201200122`), `drop` de las funciones nuevas y, al final, de las tablas nuevas (exportar antes el historial si hace falta); las columnas nuevas de las tablas del correo masivo se retiran solo cuando ninguna función las lee. Desactivar sin revertir: apagar la bandera `newsletter`.

## Contratos / OpenAPI

[`contracts/newsletter.md`](./contracts/newsletter.md). Las RPC se llaman desde el panel o la tienda (no son API pública `api-v1`): **sin cambios en `openapi/*.json`**. La Edge Function `baja-correo-masivo` conserva su contrato (`{ token }` → `{ ok: true }`).

## Piezas fuera de la base

- **`infra/kestra`**: flow nuevo `newsletter-confirmaciones.yml` (cada minuto; reclama, envía y cierra) y ajuste de `correo-masivo.yml` (plantilla del newsletter, remitente con nombre de tienda, enlace de baja al dominio de la tienda). Variables nuevas en `infra/kestra/.env.example`: `NEWSLETTER_CONFIRMACION_LOTE` (20). Se reutilizan `KESTRA_SMTP_*` y `CORREO_MASIVO_*`. Pruebas `test:kestra:newsletter-confirmaciones` y `test:kestra:correo-masivo` extendida.
- **`supabase/functions/baja-correo-masivo`**: sin cambio de contrato; solo verificar CORS para los dominios de las tiendas (T011).
- **`apps/web`** (Refine): `pages/clientes/newsletter/` (lista, KPI, suscriptores, envíos, `DialogoNuevaCampana`, `VistaPreviaNewsletter`; ruta lazy `/clientes/newsletter`, entrada «Newsletter» en Contactos), `lib/newsletter.ts` y hooks, etiquetas de Actividad, ayuda de la pantalla. **Tienda pública**: formulario en `PieTienda`, `pages/tienda-publica/newsletter/` (`FormularioSuscripcion`, confirmar, baja), rutas `/newsletter/confirmar/:token` y `/newsletter/baja/:token`, `lib/tiendaNewsletter.ts`.
- **Docs**: `docs/newsletter.md` (nuevo, en `mkdocs.yml`), notas en `docs/correo-masivo.md`, `docs/tienda-contacto.md` y `docs/deployment.md` (bandera), `docs/roadmap-template.md`, ayuda en el panel.

## Pruebas previstas

- **pgTAP**: `newsletter_suscripcion.test.sql`, `newsletter_bandera.test.sql`, `newsletter_baja.test.sql`, `newsletter_gestion.test.sql`, `newsletter_aislamiento.test.sql`, `newsletter_composicion.test.sql`, `newsletter_envio.test.sql`; extender `correo_masivo_campanas.test.sql`, `correo_masivo_lote.test.sql`, `tienda_contacto.test.sql` (origen y cupo compartido) y `exportacion_total.test.sql`; recorrer `rls_en_toda_tabla` y `privilegios_anon_endurecidos`.
- **Vitest**: pie con formulario, confirmar, baja, pantalla (KPI, tablas, diálogo, vista previa), cambio de empresa con el diálogo abierto, axe a 320/768/1440 px, `lib/newsletter.test.ts`.
- **Kestra**: `test:kestra:newsletter-confirmaciones` y `test:kestra:correo-masivo`; **Edge**: `test:edge:baja-correo-masivo`.
- **E2E**: `apps/web/e2e/tienda-newsletter.e2e.ts` (suscribir, confirmar, componer, enviar a un suscriptor de prueba, baja); se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

## RLS, permisos y grants

- Tablas nuevas: RLS por `organizacion_id`; política `select` para `authenticated` con `private.nivel_seccion('clientes')` en lectura o edición; `revoke all` a `public`/`anon`/`authenticated` y `grant select` **por columna** a `authenticated` (sin `confirmacion_hash`); sin políticas de escritura ni `DELETE`. `anon` sin privilegios.
- RPC `public` (`security definer`, `search_path = ''`, organización y rol desde la sesión): `revoke … from public, anon`, `grant execute … to authenticated`; Administrador y acceso a la tienda comprobados adentro (`42501`). Errores: `42501`, `P0002`, `22023`, `40001`, `55000`.
- RPC `publico`: únicas ejecutables por `anon`; no devuelven ids, hash ni IP; el motivo de un `error` es idéntico para host desconocido, tienda apagada y bandera apagada.
- `private.*` de confirmaciones y lote: solo `kestra_orquestacion`; `dar_de_baja_correo_masivo` solo `service_role`.

## Reversión

1. Inmediata, sin código: `update public.banderas_plataforma set activa = false where clave = 'newsletter';` (el pie deja de mostrar el formulario y el flow no envía; baja y borrado siguen).
2. Revertir el merge de la fase (`git revert -m 1`) para el front y los flows.
3. Migraciones posteriores (nunca en el mismo PR que las crea), en este orden: restaurar `reclamar_lote_correo_masivo`, `cerrar_envio_correo_masivo`, `dar_de_baja_correo_masivo`, `listar_campanas_correo` y `detalle_campana_correo` a sus cuerpos de `20270201200122`/`…123`; `drop` de las RPC `newsletter_*`; `alter table … drop column` de las columnas nuevas de las tres tablas del correo masivo (solo tras borrar o migrar las filas de `tipo = 'newsletter'`); `drop table` de `dominio.newsletters`, `newsletter_suscriptores`, `newsletter_configuracion`; restaurar el check de `tienda_envios.origen`.
