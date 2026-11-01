# Bug Assessment: invitar-cliente / recuperar-clave-cliente arman enlaces http:// en STG y PRD

- **Slug**: msf-726 (user-provided)
- **Created**: 2026-11-01
- **Source**: pasted text (Jira MSF-726)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] `invitar-cliente` y `recuperar-clave-cliente` arman enlaces `http://` en STG y PRD porque tratan `kong` como entorno local."

## Symptom

Los correos de invitación y de recuperación de clave de clientes llevan `http://<dominio>/definir-contrasena` en STG y PRD. Se esperaba `https://` (las tiendas viven en https); `http` solo debe usarse en desarrollo local.

## Reproduction

1. Desplegar el stack Supabase self-hosted (STG/PRD) donde las edge functions reciben `SUPABASE_URL` apuntando al gateway interno `http://kong:8000`.
2. Invocar `invitar-cliente` o `recuperar-clave-cliente` para un cliente con dominio de tienda.
3. Revisar el `redirectTo` / enlace del correo: sale con `http://`.

[NEEDS CLARIFICATION: valor exacto de `SUPABASE_URL` en el runtime de funciones de STG/PRD; se infiere `http://kong:8000` por el síntoma y por la regex.]

## Suspected Code Paths

- `supabase/functions/invitar-cliente/index.ts:5` — `const local = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|kong)(:|\/|$)/.test(SUPABASE_URL)`; incluye `kong`.
- `supabase/functions/invitar-cliente/index.ts:53` — `protocolo: local ? 'http' : 'https'`.
- `supabase/functions/recuperar-clave-cliente/index.ts:5` y `:30` — misma regex y misma decisión (duplicada).
- `supabase/functions/invitar-cliente/handler.ts:78` y `recuperar-clave-cliente/handler.ts:88` — arman `${protocolo}://${dominio}/definir-contrasena`.

## Root Cause Hypothesis

`kong` es el nombre del gateway interno de Docker, presente también en los despliegues self-hosted de STG/PRD (no solo en local). Al estar en la regex, `local` resulta `true` en todos los entornos con `SUPABASE_URL=http://kong:8000`, y el protocolo cae a `http`. La detección de "local" se basa en el host de `SUPABASE_URL`, que no distingue entorno. Confianza: alta (causa en código evidente; el valor de la env en STG/PRD es inferido).

## Proposed Remediation

**Preferred**: quitar `kong` de la regex y, mejor, no derivar el protocolo de `SUPABASE_URL`: usar una señal explícita de entorno (p. ej. env `SITE_PROTOCOL`/`ENTORNO_LOCAL` que solo defina el `.env` local, con default `https`). Extraer la decisión a un helper compartido en `supabase/functions/_shared/` y usarlo en ambas funciones para eliminar la duplicación. Si en local `SUPABASE_URL` es `http://kong:8000`, el local debe setear la env explícita (`.env.example` / `supabase/functions/.env` local) en vez de depender de `kong`.

**Alternatives**:
- Solo quitar `kong` de la regex: mínimo, pero rompe el enlace http en desarrollo local Docker (que usa kong) salvo que se resuelva con otra señal.

**Files likely to change**:
- `supabase/functions/invitar-cliente/index.ts`
- `supabase/functions/recuperar-clave-cliente/index.ts`
- `supabase/functions/_shared/` (helper nuevo, si se extrae)
- `.env.example` / docs (`docs/deployment.md` o `docs/acceso-ingreso.md`) con la nueva variable

**Tests to add or update**:
- Test unitario del helper: `http://kong:8000` → https; `http://localhost:54321` y `127.0.0.1` → http solo con la señal local explícita; ausencia de env → https.
- Los `handler.test.ts` existentes ya cubren el armado del enlace por `protocolo`; verificar que sigan pasando.

## Risks & Considerations

- Desarrollo local Docker puede perder el `http` si depende de `kong`: documentar/ajustar env local.
- Cambio de comportamiento en funciones desplegadas: requiere redeploy de ambas edge functions.
- Enlaces ya enviados con `http://` siguen en bandeja de clientes (redirección http→https depende de Traefik).
- Documentación obligatoria (`pnpm docs:check`): actualizar docs en el mismo cambio.

## Open Questions

- [NEEDS CLARIFICATION: ¿`SUPABASE_URL` real en STG/PRD es `http://kong:8000`? Confirmar en el despliegue.]
- [NEEDS CLARIFICATION: ¿otras funciones (p. ej. `invitar-miembro`) arman enlaces con lógica similar?] (grep de `kong` solo encontró estas dos).
