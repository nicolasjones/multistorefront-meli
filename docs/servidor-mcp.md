# Servidor MCP: credenciales, sesiones y revocación

Spec: `specs/20261005-170000-servidor-mcp-generico/`.
Contrato operativo: `packages/mcp-server/CONTRATO.md`.
Código: `packages/mcp-server/src/`.

El servidor MCP expone a clientes externos de IA (Claude, ChatGPT, cualquier
cliente MCP) las filas de las funcionalidades que una organización habilitó
para lectura. Este documento explica cómo se autentica cada llamada y qué
pasa cuando una credencial se revoca.

## Sesión y revalidación por solicitud

El protocolo Streamable HTTP es **con sesión**: el `initialize` abre una
sesión y el servidor devuelve un header `mcp-session-id` que el cliente reusa
en las siguientes solicitudes. Por eso la credencial se valida dos veces:

- **Al abrir la sesión** (`initialize`): el `Bearer` se resuelve contra
  `private.validar_credencial_mcp` y `private.resolver_credencial_id_mcp`
  (ambas `security definer`, otorgadas solo a `service_role`).
- **En cada solicitud posterior** (POST y DELETE): se revalida el mismo
  `Bearer` contra la credencial de la sesión. Una RPC por solicitud, sin TTL:
  **la revocación surte efecto en la siguiente llamada** (no hay ventana de
  cortesía).

## Qué responde qué

| Situación | Respuesta | Sesión |
|---|---|---|
| Credencial revocada (`revocada_en` no nulo) | `403` | Se cierra y se borra |
| Bearer ausente o distinto del del `initialize` | `403` | **Sigue viva** |
| Error de la base al revalidar (falla cerrado) | `403` | Sigue viva |
| `mcp-session-id` que no corresponde a ninguna sesión viva | `404` | — |

Un `Bearer` ausente o distinto **no cierra la sesión**: quien conozca o
adivine un id de sesión no tiene la credencial, y no debe poder tumbar la
sesión de otro cliente. La sesión sigue viva para su dueño, que puede
seguir usándola con su propio `Bearer`.

Un error de la base al revalidar **tampoco cierra la sesión** (falla cerrado
en la respuesta, no en el estado): un fallo transitorio de Supabase no debe
tumbar las sesiones de todos los clientes. La revocación se detecta sola en
la siguiente solicitud en que la base responde.

Las sesiones sin solicitudes durante `MCP_SESSION_IDLE_MS` (default 30 min)
se cierran y se borran — las sesiones abandonadas no se acumulan en memoria.

## Qué cubre cada pieza

- `packages/mcp-server/src/autenticacion.ts` — `autenticarConexion` (apertura
  de sesión) y `revalidarConexion` (revalidación por solicitud, que devuelve
  **el motivo** del rechazo para que el servidor sepa si debe cerrar la
  sesión).
- `packages/mcp-server/src/servidor.ts` — ruteo HTTP, revalidación, cierre y
  barrido de sesiones inactivas.
- `packages/mcp-server/src/herramientas.ts` — registro de herramientas; toda
  lectura de datos de negocio pasa por `private.mcp_leer_fila` (SQL), nunca
  filtrando filas en TypeScript.

## Pruebas

`pnpm --filter @platform/mcp-server test` (Vitest, corre dentro de
`pnpm test:ia`) cubre la revalidación por solicitud: credencial activa,
credencial revocada (cierra la sesión), Bearer ausente o distinto (no la
cierra) y error de la base.

> Verificación con un cliente MCP real contra un Supabase vivo queda fuera de
> las pruebas automáticas: el test local usa un cliente Supabase falso
> (admin inyectado) y un servidor HTTP real en un puerto efímero.
