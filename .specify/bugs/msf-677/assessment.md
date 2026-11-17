# Bug Assessment: El servidor MCP no revalida la credencial tras `initialize`

- **Slug**: msf-677
- **Created**: 2026-11-01
- **Source**: pasted text (It's a Plan MSF-677)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] El servidor MCP no revalida la credencial después del `initialize`: una credencial revocada sigue leyendo mientras viva la sesión."

## Symptom

Una vez establecida la sesión MCP, revocar la credencial (`credenciales_mcp.revocada_en`) no corta las lecturas: las herramientas `leer_*` siguen devolviendo datos de la organización hasta que la sesión muere. Esperado: la revocación surte efecto en la siguiente llamada (contrato: "credencial inválida o revocada responde 403").

## Reproduction

1. Crear credencial MCP activa; `POST /mcp` con `initialize` (Bearer) → 200 + `mcp-session-id`.
2. Revocar la credencial (RPC de revocación, `revocada_en = now()`).
3. `tools/call leer_<feature>` con el mismo `mcp-session-id` → sigue devolviendo filas.
4. Un `POST /mcp` sin sesión con el mismo token sí responde 403.

[NEEDS CLARIFICATION: reproducción no ejecutada contra Supabase real; deducida del código.]

## Suspected Code Paths

- `packages/mcp-server/src/servidor.ts:63-66` — con `sesionExistente` delega directo a `transport.handleRequest` sin autenticar; el token se valida solo en la rama de sesión nueva (líneas ~70-76). El `Authorization` de las solicitudes posteriores se ignora. Tampoco la rama `DELETE`.
- `packages/mcp-server/src/autenticacion.ts` — `autenticarConexion` solo se llama al abrir sesión; `ConexionAutenticada` guarda `token`/`organizacionId` en el closure de las herramientas.
- `packages/mcp-server/src/herramientas.ts:~44-56` — el handler de `leer_*` llama `mcp_leer_fila` con `organizacionId` capturado, sin revalidar credencial (ni siquiera `puede_mcp_leer_funcionalidad`, que además solo se evalúa al registrar).
- `supabase/migrations/20261003231600_mcp_ejecucion.sql:50-53` — `iniciar_ejecucion_mcp` SÍ revalida `revocada_en is null`, por eso las acciones `ejecutar_*` están protegidas y la lectura no (asimetría).
- `supabase/migrations/20261003230000_mcp_servidor_ia.sql:165-175` — `validar_credencial_mcp` ya comprueba `revocada_en is null`; sirve para revalidar.
- `supabase/migrations/20261003233000_mcp_lectura_centralizada.sql` — `mcp_leer_fila` filtra por organización pero no verifica credencial.

## Root Cause Hypothesis

El diseño con sesión (T029) mueve la autenticación a la apertura de sesión y la sesión reutiliza la identidad capturada. Las solicitudes con `mcp-session-id` existente saltan `autenticarConexion`, y el camino de lectura no tiene check propio de revocación (solo el de ejecución lo tiene en SQL). Confianza: alta.

## Proposed Remediation

**Preferred**: en `servidor.ts`, para toda solicitud con sesión existente (POST y DELETE) revalidar la credencial antes de delegar al transporte: extraer el Bearer, comprobar que coincide con el `token`/`credencialId` de la sesión (guardarlos en `Sesion`) y llamar a `validar_credencial_mcp`/`resolver_credencial_id_mcp` (sin insertar de nuevo en `conexiones_mcp`; separar una función `revalidarConexion` de `autenticarConexion`). Si falla: responder 403 igual que el initialize, cerrar y borrar la sesión (`transport.close()`, `sesiones.delete`). Un RPC por request; opcionalmente caché con TTL corto (p. ej. 5–10 s), documentado como ventana máxima de revocación.

**Alternatives**:
- Revalidar solo dentro del handler `leer_*` (RPC SQL que verifique `credencial_id` activa): protege lecturas pero deja `tools/list` y sesiones zombis; menos completo.
- Endurecer `mcp_leer_fila` con `p_credencial_id` en SQL (defensa en profundidad, requiere migración aditiva); complementario, no sustituto.

**Files likely to change**:
- `packages/mcp-server/src/servidor.ts`
- `packages/mcp-server/src/autenticacion.ts`
- `packages/mcp-server/CONTRATO.md` y `specs/20261005-170000-servidor-mcp-generico/` (documentar revalidación por request; obligatorio por `docs:check`)
- tests nuevos junto a `herramientas.test.ts` (o `servidor.test.ts`)

**Tests to add or update**:
- Sesión abierta + credencial revocada → siguiente `tools/call leer_*` devuelve 403 y no datos; la sesión se elimina del mapa.
- Credencial activa → llamadas posteriores siguen funcionando.
- Token distinto/ausente en solicitud con sesión existente → 403.
- DELETE con credencial revocada.

## Risks & Considerations

- Costo: una RPC extra por request (mitigable con TTL corto; define ventana de revocación).
- Clientes MCP que no reenvían `Authorization` en cada request (el SDK oficial sí lo hace con headers de transporte) podrían romper: verificar con cliente real.
- Seguridad: nunca loguear el token; usar comparación por hash en SQL.
- Sin migración necesaria en el fix preferido.

## Open Questions

- [NEEDS CLARIFICATION: ¿se acepta una ventana de revocación (TTL) o debe ser inmediata por request?]
- [NEEDS CLARIFICATION: ¿la sesión debe quedar atada al token de initialize (rechazar otro token válido)?]
