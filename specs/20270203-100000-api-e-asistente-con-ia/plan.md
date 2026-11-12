# Plan de implementación: Plataforma · API e asistente con IA (MSF-233)

**Spec**: [`spec.md`](./spec.md) · **Tareas**: [`tasks.md`](./tasks.md) · **Contratos**: [`contracts/`](./contracts/)
**Alcance de entrega**: `refine`, `supabase`, `kestra`.

## Resumen técnico

- **F-API-01**: Edge Function `api-v1` (lectura versionada, auth por clave, límite, auditoría) + Edge Function `entregar-webhook` + flow de Kestra que reclama eventos de `public.cola_eventos`, hace fan-out a `public.api_entregas` (outbox por destinatario) y entrega por suscripción; flow de Kestra `purgar-api-llamadas` para la retención de 90 días. Pantalla «API» en Refine (`/api`) con claves, suscripciones, entregas y llamadas.
- **F-IA-01**: migración de datos y cuatro vistas de solo lectura; sin código de motor nuevo. Reutiliza `chat-ia-responder`, `packages/mcp-server`, `private.mcp_leer_fila`, `private.puede_chat_leer_funcionalidad`, `private.puede_mcp_leer_funcionalidad` e `ia_politicas`.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por `organizacion_id` en las 4 tablas nuevas; lectura de la API con filtro dentro de SQL (`private.api_leer_*`); vistas IA `security_invoker`; service-role solo en Edge Functions |
| II Spec primero | esta spec; D-1…D-10 confirmadas, sin preguntas abiertas |
| III Idempotencia/auditoría | `unique (evento_id, suscripcion_id)`, claves de idempotencia en `cola_eventos`, `api_llamadas`, `ia_interacciones`/MCP |
| IV Despliegues independientes | sin Compose raíz; Kestra y Supabase mantienen su ciclo |
| V Simplicidad | sin infraestructura nueva: se reutiliza la outbox, Kestra, Vault y las capacidades IA existentes |
| VI Panel operable | entrada «API» bajo Administración, audiencia Administrador, ruta `/api`, patrones de estado, 320/768/1440 px |
| VII Esquemas | todas las tablas nuevas en `public` (plataforma/integraciones); re-verificar en cada tarea de migración |
| VIII Empresa activa | no aplica (por organización); test que lo demuestra (T010) |

## Migraciones (aditivas; una a la vez, en serie)

Las migraciones se renumeraron al integrar con `dokploy` (commit `13f1879a`); los nombres de esta tabla son los reales. Cada historia trae la suya y no se encadenan entre sí. Ninguna migración queda `[ ]` sin evidencia.

| Orden | Archivo | Historia | Reversión |
|---|---|---|---|
| 1 | `20270224110000_ia_consulta_vistas.sql` | F-IA-01 | `drop view public.ia_consulta_catalogo/stock/precios/ventas` |
| 2 | `20270224110100_ia_consulta_registro.sql` | F-IA-01 | borrar las filas registradas por feature (inversa idempotente: `delete from fuentes_*` y `capacidades_*`; `features` solo si no las usa otra cosa) |
| 3 | `20270224110200_ia_consulta_tope_mcp.sql` | F-IA-01 | volver a la definición de `20261003233000` |
| 4 | `20270224110201_api_claves.sql` | F-API-01 | retirar grants/RPC → políticas → índices → `api_claves` |
| 5 | `20270224110202_api_llamadas_y_limite.sql` | F-API-01 | ídem para `api_llamadas` y `private.purgar_api_llamadas`; los grants a `service_role` |
| 6 | `20270224110203_api_lectura.sql` | F-API-01 | `drop function private.api_leer_productos/stock/precios/ventas` (y los wrappers `public.api_leer_*`) |
| 7 | `20270224110204_api_suscripciones_entregas.sql` | F-API-01 | grants/RPC → funciones de lease/fan-out → políticas → `api_entregas`, `api_suscripciones`; el secreto de Vault se borra aparte |
| 8 | `20270224110205_api_eventos_precio_venta.sql` | F-API-01 | `drop trigger` + `drop function private.emitir_precio_actualizado/emitir_venta_registrada`; los eventos ya encolados no se borran |
| 9 | `20270224110206_exportacion_total_excluye_api.sql` | F-API-01 | volver a la definición previa de la exportación total, sin las 4 filas `api_*` |
| 10 | `20270227100000_api_decodificar_cursor_devuelve_fila.sql` | F-API-01 | volver a la definición de `20270224110203` |
| 11 | `20270227120000_api_cursor_sin_saltos_de_linea.sql` | F-API-01 | volver a `20270224110203` y `20270227100000` |
| 12 | `20270228100000_api_menores_revision_msf233.sql` | F-API-01 | volver a las definiciones de `20270224110201/110202/110204` y `drop` de los 3 índices keyset |
| 13 | `20270301100000_api_decisiones_abiertas_msf233.sql` | F-API-01 | volver a las definiciones previas; `drop` del índice `api_suscripciones_secreto_vault_uidx`, del trigger `api_suscripciones_borrar_secreto` y de las funciones `private.api_borrar_secreto_suscripcion` y `private.api_cursor_partes`; el índice `producto_precios_escala_org_updated_idx`; y volver a `on delete cascade` en las dos claves foráneas `creada_por` (antes de `set not null` hay que rellenar o borrar las filas con `creada_por` nulo) |
| 14 | `20270302100000_api_seguimientos_msf233.sql` | F-API-01 | `drop` de `public.reintentar_entrega_api(uuid)`, `private.api_entregas_salud(integer, integer)` e índice `cola_eventos_terminados_idx`; volver `private.purgar_api_llamadas` a la definición de `20270301100000` |

Ninguna columna ni tabla se destruye en el mismo PR que la crea. Cada RPC de `public` lleva `grant execute … to authenticated` explícito (o `service_role`) y `revoke … from public, anon`; el test que falla si `anon` ejecuta otra función de `public` debe seguir verde. `api_claves.hash` no se otorga a `authenticated`: se usa `grant select (columnas seguras)`.

## Decisiones de implementación

### Claves de API

- Formato del token: `msf_<prefijo-8-hex>_<secreto-base64url-32-bytes>`. Se persiste `prefijo` (unique) y `hash = digest(token, 'sha256')` con `pgcrypto` (`extensions.digest`), igual que `credenciales_mcp`.
- `crear_clave_api(p_nombre, p_alcances, p_vence_en)` valida Administrador de la organización, alcances no vacíos y subconjunto de `productos/stock/precios/ventas`; devuelve `{ id, valor }` una sola vez.
- `rotar_clave_api(p_clave_id)` crea una nueva con los mismos nombre/alcances, fija `vence_en = now() + interval '24 hours'` en la anterior y devuelve `{ id, valor }`.
- `revocar_clave_api(p_clave_id)` fija `revocada_en = now()`; la siguiente llamada responde `401`.
- `api_validar_clave(p_token)` devuelve `{ valida, clave_id, organizacion_id, alcances, limite_por_minuto, motivo }`; si el prefijo existe pero el hash no coincide, devuelve la organización/clave con `valida = false` para poder auditar el `401`.
- `api_controlar_limite(p_clave_id)` cuenta `api_llamadas` de los últimos 60 s y devuelve `{ permitido, reintentar_en_seg, restantes }`; usa un lock por clave para que dos llamadas simultáneas no pasen ambas el límite.
- `api_registrar_llamada(...)` acepta `organizacion_id`/`clave_id` nulos (prefijo desconocido) y actualiza `api_claves.ultimo_uso_en` solo en llamadas autenticadas.

### Lectura de la API

- `private.api_leer_productos/stock/precios/ventas(p_organizacion_id uuid, p_cursor text, p_limite integer, p_actualizado_desde timestamptz)` son `security definer`, `set search_path = ''`, y arman `where organizacion_id = p_organizacion_id` dentro del SQL. `p_limite` por defecto 50, máximo 100.
- `productos`: `dominio.productos` (id, nombre, sku, activo, categoria_id, moneda, precio_lista, updated_at); `categoria` se resuelve con `dominio.categorias`.
- `stock`: `public.stock_por_deposito` + `dominio.productos` + `dominio.depositos` (producto, depósito, cantidad, reservado, disponible, updated_at).
- `precios`: `dominio.productos` (`precio_lista`, `moneda`, `updated_at`) y `dominio.producto_precios_escala` (escalas x5/x10/x50). No se calcula precio por empresa ni IVA.
- `ventas`: `dominio.comprobantes_venta` con `tipo = 'factura'` y `estado = 'confirmada'` (id, número, fecha, empresa, totales, estado, `confirmado_en`); no expone cliente.
- Cursor opaco: base64 de `(actualizado_en, id)`; en ventas, de `(confirmado_en, id)`. `actualizado_desde` filtra por esa misma columna.

### Eventos y webhooks

- `private.emitir_precio_actualizado()`: trigger `after insert or update of precio_lista, moneda` en `dominio.productos` (solo si cambia el precio/moneda) y `after insert or update of precio` en `dominio.producto_precios_escala` (solo si cambia el precio). Inserta en `cola_eventos` con `tipo = 'precio.actualizado'` y `clave_idempotencia = producto_id || ':' || coalesce(escala,'x1') || ':' || extract(epoch from updated_at) || ':' || txid_current()`.
- `private.emitir_venta_registrada()`: trigger `after insert or update of estado` en `dominio.comprobantes_venta`; emite solo cuando `new.tipo = 'factura'`, `new.estado = 'confirmada'` y (`tg_op = 'INSERT'` o `old.estado is distinct from 'confirmada'`); `clave_idempotencia = new.id::text`.
- `stock.actualizado` ya existe (`private.emitir_stock_actualizado`, después de insertar en `dominio.movimientos_stock`); no se toca.
- El flow de Kestra `entregar-webhooks-api` usa `private.reclamar_eventos` con `p_max_intentos = 5` para reclamar el evento, llama a `private.api_fanout_evento(evento_id)` (inserta una `api_entregas` por suscripción activa con `on conflict (evento_id, suscripcion_id) do nothing`), resuelve el evento y luego procesa las entregas con `private.api_reclamar_entregas`/`private.api_resolver_entrega`.
- `api_entregas` tiene 5 intentos y espera `60 s × 2^(n−1)`; el estado final es `agotada` y `ultimo_error_sanitizado` se recorta a 500 caracteres sin URLs con credenciales ni secretos.
- La Edge Function `entregar-webhook` firma `t=<epoch>,v1=<hmac-sha256-hex>` sobre `<t>.<body>` con el secreto de `vault.secrets` (`secreto_vault_id`), envía `X-Evento-Id` y `Content-Type: application/json`, usa timeout de 10 s y no sigue redirecciones.
- SSRF al guardar: solo `https`, sin usuario/clave en la URL, host que no sea `localhost` ni IP literal privada/loopback/link-local/metadata. SSRF al entregar: resolver DNS y rechazar si el destino cae en esos rangos; si cambia, falla la entrega sin seguir redirecciones.
- Retención: `private.purgar_api_llamadas(p_retencion_dias integer default 90)` borra `api_llamadas` más viejas; la ejecuta un flow de Kestra programado (`purgar-api-llamadas`), no `pg_cron`.

### IA

- Cuatro features (`catalogo`, `stock`, `precios`, `ventas`) insertadas con `on conflict do nothing` y sus `eventos_features` (`feature_registrada`) solo si se insertó la fila. Como `registrar_feature` exige `auth.uid()`/superadmin, la migración de datos usa `insert` directo y deja el mismo `id`/`nombre`/`descripcion`.
- `fuentes_chat_ia`/`fuentes_mcp`: **una vista por feature** porque `private.mcp_leer_fila` hace `limit 1` sobre `fuentes_mcp`; cada feature tiene exactamente una fila con su `ia_consulta_*`.
- `capacidades_chat_ia`/`capacidades_mcp`: `lectura = true`, `ejecucion = false`; `on conflict (feature_id) do update` solo para asegurar `lectura`/`ejecucion` sin tocar `actualizado_por`/`actualizado_en` si ya existía.
- Vistas `security_invoker = true`, `grant select` a `authenticated` y `service_role`; `revoke` a `public`/`anon`. El chat las lee con la sesión del usuario (RLS de las tablas base); MCP las lee con `private.mcp_leer_fila` (filtro de organización dentro del SQL).
- Secciones de permiso reales: `productos` (catálogo y precios), `stock` (stock), `ventas` (ventas). No existe `nivel_seccion('precios')`.
- Tope de 50 filas por consulta: se aplica en la vista (o en el `select` del chat) y en `mcp_leer_fila`; el chat ya tiene el límite de la política IA. Si no hay presupuesto de Gateway IA declarado, se anota en el PR y se difiere.

### Pantalla «API»

- Entrada `{ id: 'api', etiqueta: 'API', ruta: '/api', icono: ApiIcon, audiencia: 'administrador' }` en la sección Administración de `apps/web/src/components/navegacion/destinosPanel.ts`; sin `seccionPermiso` (la gestión es del Administrador, no de la matriz de secciones).
- Ruta `/api` en `apps/web/src/App.tsx` protegida por `RequiereOrganizacionActiva`; no hay ruta anterior.
- Las tablas se leen directo con PostgREST usando los grants de columna; las acciones llaman a las RPC. El valor de la clave y el secreto de la suscripción se muestran en un diálogo una sola vez con `Copiar`.
- Estados compartidos de carga, vacío, error y éxito; teclado y lector de pantalla; 320/768/1440 px. No lee `empresa_id` ni reacciona al cambio de empresa.

## Artefactos por historia

**F-API-01**: `supabase/functions/api-v1/`, `supabase/functions/entregar-webhook/`, `openapi/api-v1.json`, `openapi/entregar-webhook.json`, flows `entregar-webhooks-api` y `purgar-api-llamadas` en `infra/kestra/flows/`, `apps/web/src/pages/api/*`, entrada de navegación, `docs/api-publica.md`, pgTAP (`api_claves`, `api_llamadas`, `api_aislamiento`, `api_suscripciones_entregas`, `api_eventos`), Vitest/Deno y scripts de OpenAPI.

**F-IA-01**: migraciones 6 y 7, vistas `ia_consulta_*`, registro de features/fuentes/capacidades, `docs/asistente-catalogo.md`, pgTAP (`ia_consulta_vistas`, `ia_consulta_registro`) y Vitest de las pantallas existentes.

## Riesgos

- **SSRF en webhooks**: validar al guardar y al entregar (resolver DNS y rechazar rangos privados); revisión de seguridad antes del PR.
- **Secreto de firma**: se guarda en Vault (`secreto_vault_id`); la Edge Function lo lee con `service_role` y nunca se expone al navegador ni a Git.
- **Fan-out vs `cola_eventos`**: un evento se completa al generar sus entregas; los reintentos viven en `api_entregas`. Si el fan-out falla, el evento se reintenta con el lease de `cola_eventos`.
- **Límite de la IA (D-8)**: si el presupuesto del Gateway IA no existe, se difiere y se anota en el PR.
- **Precio real**: la API y el asistente exponen `precio_lista`/`moneda`; el precio final por empresa/IVA no se calcula en esta épica.
- **Ventas**: solo facturas confirmadas; presupuestos y notas de crédito quedan fuera de `/v1/ventas` y de `venta.registrada`.

## Verificación

`pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` (con `pnpm dev:supabase`), `pnpm docs:check`, `pnpm matriz:check`, `pnpm test:openapi`, `pnpm test:edge:api-v1`, `pnpm test:edge:entregar-webhook`, `pnpm test:kestra:webhooks` y `rls_en_toda_tabla`.
