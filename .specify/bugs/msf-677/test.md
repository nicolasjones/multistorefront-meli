# Verificación: msf-677

Tests nuevos en `packages/mcp-server/src/servidor.test.ts` (servidor HTTP real + admin falso):
- credencial activa → la sesión sigue respondiendo (200);
- revocada tras el `initialize` → 403 y la sesión se elimina;
- token distinto en sesión existente → 403;
- DELETE con credencial revocada → 403;
- `revalidarConexion` unitario (activa / revocada / ausente / distinto).

Resultado: `pnpm build` y `pnpm test` en `packages/mcp-server`: 2 archivos, 9 tests OK.
Pendiente de CI: verificación con cliente MCP real contra Supabase (no ejecutada localmente).
