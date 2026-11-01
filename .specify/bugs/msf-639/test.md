# Test MSF-639

- `vitest run` de `empresas/list.test.tsx`, `organizacion/edit.test.tsx` y `empresas/edit.test.tsx`: **verde (56/56)**. Los asserts exigen «No tenés acceso a esta sección» como encabezado de nivel 1 y el motivo «Tu rol (actual) no incluye Empresas/Mi organización. Pedile acceso a un administrador.», y un `role="note"` sin `role="alert"` para «Solo lectura».
- `pnpm lint` (oxlint): exit 0, solo warnings preexistentes en archivos no tocados.
- `pnpm build` (`tsc -b && vite build`): exit 0.
- `pnpm docs:check`: OK (58 archivos comparados contra HEAD~1; migraciones: 0 nuevas contra `origin/dokploy`).
- `pnpm calidad`: `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` OK; `gitleaks` no corrió (necesita el daemon de Docker, no disponible en este entorno) → queda para el CI.
- E2E: no aplica (cambio de presentación cubierto por Vitest; no hay criterios de aceptación de pantalla con video en esta historia).
