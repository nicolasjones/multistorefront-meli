# Contrato operativo del servidor MCP

Mismo criterio que `workers/CONTRATO.md`, adaptado a un servicio HTTP de
larga vida (no un proceso puntual por ejecución).

## Entrada y salida

Escucha HTTP en `MCP_SERVER_PORT` (default 8787), sobre `node:http` nativo
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
independiente del resto de la plataforma. `MCP_SERVER_PORT` (default 8787)
y `SUPABASE_SERVICE_ROLE_KEY` se configuran en `.env` (nunca versionado) —
ver `.env.example`.
