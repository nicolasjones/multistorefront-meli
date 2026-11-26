# Contrato operativo del servidor MCP

Mismo criterio que `workers/CONTRATO.md`, adaptado a un servicio HTTP de
larga vida (no un proceso puntual por ejecución).

## Entrada y salida

Escucha HTTP en `MCP_SERVER_PORT` (default del proceso 8787; el compose de desarrollo `infra/mcp-server/compose.yaml` publica 8788), sobre `node:http` nativo
(sin Express — ver research.md R8, incompatibilidad real encontrada con el
puente Hono del SDK), rutas `POST /mcp` y `DELETE /mcp` (protocolo
Streamable HTTP, modo **con sesión**: `sessionIdGenerator` genera un
`mcp-session-id` que el cliente reusa en solicitudes siguientes — no un
server nuevo por solicitud, research.md R4/R8). La credencial en
`Authorization: Bearer <token>` se valida al abrir la sesión (el `initialize`)
y **se revalida en cada solicitud posterior** (POST y DELETE) de esa sesión:
el Bearer debe ser el mismo del `initialize` y su credencial seguir activa
(`resolver_credencial_id_mcp`, una RPC por solicitud, sin TTL: la revocación
surte efecto en la siguiente llamada).

La revalidación distingue **por qué** se rechaza, porque no todas las causas
cierran la sesión:

| Situación | Respuesta | Sesión |
|---|---|---|
| Credencial revocada (`revocada_en` no nulo) | `403` | Se cierra y se borra |
| Bearer ausente o distinto del del `initialize` | `403` | **Sigue viva** (su dueño puede seguir usándola) |
| Error de la base al revalidar (falla cerrado) | `403` | Sigue viva (un fallo transitorio no tumba sesiones) |
| `mcp-session-id` que no corresponde a ninguna sesión viva | `404` | — |

Que un Bearer ausente o distinto NO cierre la sesión es deliberado: quien
conozca o adivine un id de sesión no tiene la credencial y no debe poder
tumbar la sesión de otro cliente. Las sesiones sin solicitudes durante
`MCP_SESSION_IDLE_MS` (default 30 min) se cierran y se borran.

Variables de entorno requeridas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
El servidor en sí **no invoca ningún proveedor de IA** — solo expone datos y
acciones como herramientas MCP; quien genera texto o decide qué invocar es
el cliente externo (Claude Desktop u otro), no este proceso. Por eso no
necesita (ni debe esperar) una política/contrato de `packages/ia` aprobado
para funcionar — eso solo aplicaría si alguna herramienta futura generara
contenido con un modelo, que hoy ninguna hace.

## Autenticación

Una credencial inválida o revocada responde `403` antes de listar ninguna
herramienta. Toda lectura de datos de negocio pasa exclusivamente por
`private.mcp_leer_fila` (SQL, `security definer`) — el filtro de
organización vive ahí, no en este código (research.md R6).

## Pruebas

`pnpm --filter @platform/mcp-server test` (Vitest) cubre la revalidación por
solicitud: credencial activa, revocada (cierra la sesión), Bearer ausente o
distinto (no la cierra) y error de la base. Corre dentro de `pnpm test:ia`.

## Despliegue

Contenedor propio: `infra/mcp-server/Dockerfile` + `infra/mcp-server/compose.yaml`
(`pnpm dev:mcp-server` / `pnpm dev:down:mcp-server`), mismo patrón que
`infra/refine` — sin Compose raíz (Principio IV), ciclo de despliegue
independiente del resto de la plataforma. `MCP_SERVER_PORT` (default 8787 en el proceso, 8788 en el compose)
y `SUPABASE_SERVICE_ROLE_KEY` se configuran en `.env` (nunca versionado) —
ver `.env.example`.

## Robustez del servidor (lote de funciones edge, MSF-729)

- Una excepción no controlada del handler HTTP responde `500 {"error":"Error interno."}` y queda en el log: no termina el proceso ni tumba el MCP de las demás organizaciones. Los mensajes de la base nunca llegan al cliente externo (`EJECUCION_EN_CURSO`, `EJECUCION_NO_DISPONIBLE`, `ERROR_AL_EJECUTAR`, `ERROR_AL_LEER`); el detalle queda en `ejecuciones_mcp.motivo_error` (solo superadmin) y en el log.
- Nombres de herramienta: una funcionalidad con una sola fila en `fuentes_mcp`/`acciones_mcp` conserva `leer_<feature>`/`ejecutar_<feature>`; con varias filas (la PK permite `(feature_id, vista)` y `(feature_id, rpc)`; desde el lote 89 un índice único por `feature_id` lo impide, y esto queda como defensa) cada herramienta es `leer_<feature>_<vista>` / `ejecutar_<feature>_<rpc>`. Un nombre repetido se omite en vez de abortar el `initialize`.
- Candado de ejecución: `iniciar_ejecucion_mcp` (SQL) vence, dentro de su transacción y antes de poner el candado, las ejecuciones `en_curso` de esa credencial y funcionalidad con más de 10 minutos (`private.ejecucion_mcp_vence_min()`; `estado='fallida'`, `motivo_error='vencida'`); el servidor ya no lo hace ni lee `MCP_EJECUCION_VENCE_MIN`. Si `finalizar_ejecucion_mcp` falla, se registra en el log.
- `fuentes_mcp` y `acciones_mcp` admiten una sola fila por funcionalidad (índice único por `feature_id`, lote 89).
- Override de organización en `ejecutar_*`: se pisa con la de la credencial cualquier parámetro cuyo nombre termine en `organizacion_id` o, normalizado, sea `organizacion`, `organizacion_id`, `organizacionId`, `p_organizacion_id`, `org_id`, `organization_id`… Sigue siendo una defensa de segundo nivel: la garantía real debe ser un wrapper SQL por acción que reciba la organización desde la credencial (pendiente, ver `docs/funciones-edge-limites-y-registro.md`).
- El compose de `infra/mcp-server` es de **desarrollo** (`tsx watch`, bind mount del repo y `service_role` en el entorno): no usarlo tal cual en un ambiente compartido.
