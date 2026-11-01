# Test MSF-639

- `vitest run` de `empresas/list.test.tsx`, `organizacion/edit.test.tsx` y `empresas/edit.test.tsx`: verde (56/56). Los asserts ahora exigen «No tenés acceso a esta sección» y un `role="note"` sin `role="alert"` para «Solo lectura».
- `tsc --noEmit`, `pnpm lint` (solo warnings previos), `pnpm --filter @platform/web build` y `pnpm docs:check`: ok.
- E2E: no aplica (cambio de presentación cubierto por Vitest).
