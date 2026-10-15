# Fix: MSF-499 — harness Playwright de la app

- Agregado `@playwright/test` 1.61.0 a `apps/web`, `playwright.config.ts` (testMatch `*.e2e.ts`, webServer `vite preview`, `E2E_BASE_URL` opcional) y scripts `test:e2e` (web y raíz; fuera de `pnpm test`).
- Primer spec `apps/web/e2e/acceso-publico.e2e.ts`: ruta protegida → ingreso, camino a recuperación, enlace vencido, sin registro (parte pública de MSF-119 T020).
- `docs/e2e-app.md` con uso y tabla de cobertura; `.gitignore` de salidas de Playwright.
- **No** implementado (requiere stack Supabase completo + fixtures por rol, no disponible aquí): ingreso/cierre con sesión, T019, T036, T043b, empresas, organización, verificación manual, job de CI. Siguen abiertos en las tasks.md de origen; no se tildó ninguna.

## Devolución del Revisor (PR #64)

- Job `e2e-web` en `validate.yml`: DIFERIDO a seguimiento (token sin scope `workflow`); no va en este PR.
- `playwright.config.ts` valida `dist/` antes de levantar `vite preview`.
- Test «sin registro»: espera el heading y exige que el único enlace sea «¿Olvidaste tu contraseña?» (sin regex ni falso verde).
- Revertido el ruido de harness (`.specify/extensions*`, `.claude/skills/speckit-bug-*`) a la rama épica.
- Los recorridos con sesión siguen pendientes (requieren stack Supabase completo + fixtures por rol); esta incidencia es el seguimiento trazado.

## Segunda devolución del Revisor (PR #64)

- `globalSetup` eliminado: Playwright levanta el `webServer` antes, así que el mensaje nunca se veía. La verificación de `dist/` pasa al comando del `webServer` (`node e2e/verificar-dist.mjs && pnpm preview`).
- Test «sin registro»: la regex suma `sign ?up`, `nueva cuenta` y `alta`.
- Falso verde por otro servicio en `WEB_PORT`: aceptado; los specs afirman headings propios de la app.
- Job `e2e-web`: sigue diferido (scope `workflow`).
