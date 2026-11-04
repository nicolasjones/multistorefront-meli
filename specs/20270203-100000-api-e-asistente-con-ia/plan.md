# Plan de implementación: Plataforma · API e asistente con IA (MSF-233)

**Spec**: [`spec.md`](./spec.md) · **Tareas**: [`tasks.md`](./tasks.md) · **Contratos**: [`contracts/`](./contracts/)
**Alcance de entrega**: `refine`, `supabase`, `kestra`.

## Resumen técnico

- **F-API-01**: Edge Function `api-v1` (lectura versionada, auth por clave, límite, auditoría) + Edge Function `entregar-webhook` + flow de Kestra que reclama eventos de `public.cola_eventos` y entrega por suscripción con `public.api_entregas` (outbox por destinatario). Pantalla «API» en Refine.
- **F-IA-01**: migración de datos y vistas de solo lectura; sin código de motor nuevo. Reutiliza `chat-ia-responder`, `packages/mcp-server`, `private.mcp_leer_fila`, `ia_politicas`.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por `organizacion_id` en las 4 tablas nuevas; lectura con filtro dentro de SQL; service-role solo en Edge Functions |
| II Spec primero | esta spec; decisiones D-1…D-10 con valor por defecto |
| III Idempotencia/auditoría | `unique (evento_id, suscripcion_id)`, claves de idempotencia en `cola_eventos`, `api_llamadas` |
| IV Despliegues independientes | sin Compose raíz; Kestra y Supabase mantienen su ciclo |
| V Simplicidad | sin infraestructura nueva: se reutiliza la outbox y Kestra |
| VI Panel operable | entrada «API» bajo Administración, audiencia Administrador, rutas `/api`, patrones de estado, 320/768/1440 px |
| VII Esquemas | todas las tablas nuevas en `public` (plataforma/integraciones); re-verificar en cada tarea de migración |
| VIII Empresa activa | no aplica (por organización); test que lo demuestra (T010) |

## Migraciones (aditivas; una a la vez, en serie)

Timestamps reservados; cada historia trae la suya y no se encadenan entre sí.

| Orden | Archivo | Historia | Reversión |
|---|---|---|---|
| 1 | `20270203100000_api_claves.sql` | F-API-01 | retirar grants/RPC → políticas → índices → `api_claves` |
| 2 | `20270203100100_api_llamadas_y_limite.sql` | F-API-01 | ídem para `api_llamadas` y funciones de límite |
| 3 | `20270203100200_api_lectura.sql` | F-API-01 | `drop function private.api_leer_*` |
| 4 | `20270203100300_api_suscripciones_entregas.sql` | F-API-01 | grants/RPC → políticas → `api_entregas`, `api_suscripciones` |
| 5 | `20270203100400_api_eventos_precio_venta.sql` | F-API-01 | `drop trigger` + `drop function private.emitir_*`; los eventos ya encolados no se borran |
| 6 | `20270203110000_ia_consulta_vistas.sql` | F-IA-01 | `drop view public.ia_consulta_*` |
| 7 | `20270203110100_ia_consulta_registro.sql` | F-IA-01 | borrar las filas registradas por feature (inversa idempotente) |

Ninguna columna ni tabla se destruye en el mismo PR que la crea. Cada RPC de `public` lleva `grant execute … to authenticated` explícito (o `service_role`) y `revoke … from public, anon`; el test que falla si `anon` ejecuta otra función de `public` debe seguir verde.

## Artefactos por historia

**F-API-01**: `supabase/functions/api-v1/`, `supabase/functions/entregar-webhook/`, `openapi/api-v1.json`, flow `entregar-webhooks-api` en el directorio de flows de Kestra, `apps/web/src/pages/api/*`, entrada de navegación, `docs/api-publica.md`, pgTAP (`api_claves`, `api_aislamiento`, `api_entregas`), Vitest/Deno.

**F-IA-01**: migraciones 6 y 7, ajustes de verificación en `chat-ia-responder`/`mcp_leer_fila` solo si faltara el tope de filas (FR-023), `docs/asistente-catalogo.md`, pgTAP y Vitest.

## Riesgos

- **Eventos de precio y venta**: las tablas origen no están confirmadas (D-5); T005 empieza verificándolas con `graphify` y las migraciones.
- **SSRF en webhooks**: validar al guardar y al entregar (resolver DNS y rechazar rangos privados); revisión de seguridad antes del PR.
- **Secreto de firma**: debe ser recuperable para firmar; se guarda en el gestor de secretos del proyecto (referencia en `secreto_ref`), nunca en claro ni en Git.
- **Fan-out vs `cola_eventos`**: un evento se completa al generar sus entregas; los reintentos viven en `api_entregas`.
- **Límite de la IA (D-8)**: si el presupuesto del Gateway IA no existe, se difiere y se anota en el PR.

## Verificación

`pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` (con `pnpm dev:supabase`), `pnpm docs:check`, `pnpm matriz:check`, guard de contratos.
