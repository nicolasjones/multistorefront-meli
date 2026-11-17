# Fix: msf-677

- **Remediación aplicada**: la preferida del assessment (revalidación por solicitud, sin TTL, sin migración).
- `packages/mcp-server/src/autenticacion.ts`: `revalidarConexion` (mismo Bearer del `initialize` con comparación en tiempo constante + `resolver_credencial_id_mcp` activo y con el mismo `credencialId`; falla cerrado ante error de base). No inserta en `conexiones_mcp`.
- `packages/mcp-server/src/servidor.ts`: la `Sesion` guarda la `conexion`; todo POST/DELETE con `mcp-session-id` revalida antes de delegar al transporte; si falla → 403, `transport.close()` y borrado de la sesión. Expiración de sesiones inactivas (`MCP_SESSION_IDLE_MS`, default 30 min, barrido con timer `unref`). `crearServidorHttp` acepta un admin inyectado (tests).
- `packages/mcp-server/CONTRATO.md`: documenta la revalidación por solicitud y la expiración.
- Decisiones a las preguntas abiertas: revocación inmediata (sin ventana TTL) y sesión atada al token del `initialize`.
- Riesgo: una RPC extra por solicitud; clientes que no reenvíen `Authorization` en cada solicitud recibirán 403.
