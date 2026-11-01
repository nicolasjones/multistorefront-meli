# Fix: MSF-726 (slug msf-726)

Causa: `index.ts` de `invitar-cliente` y `recuperar-clave-cliente` trataba `kong` (gateway interno, también en STG/PRD) como entorno local → `http://`.

Cambios:
- Nuevo `supabase/functions/_shared/protocolo.ts` (`protocoloTienda`): `http` solo con `ALLOW_HTTP_REDIRECT=true`; por defecto `https`. Se dejó de derivar de `SUPABASE_URL`.
- Ambos `index.ts` usan el helper (regex eliminada).
- `supabase/functions/.env.example`: `ALLOW_HTTP_REDIRECT=true` solo para local.
- `docs/acceso-ingreso.md` documenta la regla; `package.json` suma `test:edge:protocolo` a `test:web`.

Despliegue: redeploy de ambas funciones; NO definir `ALLOW_HTTP_REDIRECT` en STG/PRD. Los correos ya enviados con `http://` siguen en bandejas.
Reversión: `git revert -m 1` del merge. Sin cambios de BD. OpenAPI: no hay `openapi/` en el repo; el contrato de las funciones no cambia.
