# Bug Verification: la tienda pública manda al visitante a `/login` (404) y le cierra la sesión tras 12 h

- **Slug**: msf-673
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

En un host de tienda, el primer clic tras 13 h sin actividad no navega a `/login`, no muestra la 404 y no revoca la sesión globalmente: MSF-700 cierra solo la sesión local y vuelve a `/`. El panel sigue yendo a `/login`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| E2E | `pnpm --filter @platform/web exec playwright test e2e/tienda-sesion-vencimiento.e2e.ts` (build con `VITE_PANEL_HOSTS=localhost,127.0.0.1`) | ver Local Verification | Se omite si el host no se sirve como tienda. |
| Lint / build / docs | `pnpm lint`, `pnpm --filter @platform/web build`, `pnpm docs:check` | ver Local Verification | |

Las pruebas unitarias de `arranque.test.ts` y la regresión sobre `main.tsx` de la versión anterior se descartaron junto con `lib/arranque.ts`.

## Residual Risks

- El E2E no necesita Supabase; la resolución de la tienda por dominio no se ejercita.
- Sin `VITE_PANEL_HOSTS` en el build el E2E se omite.
- Seguimiento MSF-740 para una regla propia de inactividad en la tienda.

## Recommendation

Cerrar el bug: el comportamiento lo aporta MSF-700 y el E2E lo deja fijado como regresión.
