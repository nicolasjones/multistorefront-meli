# Test: MSF-726

Resultado: passed (local)
- `pnpm test:edge:protocolo` 4/4 (incluye: sin la variable → https aun con SUPABASE_URL=http://kong:8000; `true` → http).
- `pnpm test:edge:invitar-cliente` 15/15; `pnpm test:edge:recuperar-clave-cliente` 9/9.
- `pnpm docs:check` OK.
Pendiente tras el deploy: verificar en STG/PRD que el `redirectTo` del correo sea https.
