# Fix: MSF-499 — harness Playwright de la app

- Agregado `@playwright/test` 1.61.0 a `apps/web`, `playwright.config.ts` (testMatch `*.e2e.ts`, webServer `vite preview`, `E2E_BASE_URL` opcional) y scripts `test:e2e` (web y raíz; fuera de `pnpm test`).
- Primer spec `apps/web/e2e/acceso-publico.e2e.ts`: ruta protegida → ingreso, camino a recuperación, enlace vencido, sin registro (parte pública de MSF-119 T020).
- `docs/e2e-app.md` con uso y tabla de cobertura; `.gitignore` de salidas de Playwright.
- **No** implementado (requiere stack Supabase completo + fixtures por rol, no disponible aquí): ingreso/cierre con sesión, T019, T036, T043b, empresas, organización, verificación manual, job de CI. Siguen abiertos en las tasks.md de origen; no se tildó ninguna.
