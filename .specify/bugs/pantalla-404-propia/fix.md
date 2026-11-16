# Bug Fix: Pantalla 404 en inglés y sin estilo

- **Slug**: pantalla-404-propia
- **Assessment**: ./assessment.md
- **Status**: applied

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/pages/no-encontrada/PaginaNoEncontrada.tsx` | added | Pantalla 404 en castellano con el estilo de la app. |
| `apps/web/src/App.tsx` | modified | La ruta `*` usa `PaginaNoEncontrada` en lugar de `ErrorComponent`. |
| `apps/web/src/pages/no-encontrada/PaginaNoEncontrada.test.tsx` | added | Textos en castellano y enlace a la raíz. |

## Deviations from Assessment

Ninguna.
