# Test MSF-639

- `vitest run` de `empresas/list.test.tsx`, `organizacion/edit.test.tsx` y `empresas/edit.test.tsx`: **verde (56/56)**. Los asserts exigen «No tenés acceso a esta sección» como encabezado de nivel 1 y el motivo «Tu rol (actual) no incluye Empresas/Mi organización. Pedile acceso a un administrador.», que **no** aparezca el aviso viejo «Acceso restringido» ni ninguna alerta de tono error (`MuiAlert-standardError`), y un `role="note"` sin `role="alert"` para «Solo lectura».
- `pnpm lint` (oxlint): exit 0, solo warnings preexistentes en archivos no tocados.
- `pnpm build` (`tsc -b && vite build`): exit 0.
- `tsc --noEmit` sobre `apps/web/e2e/` (config temporal, no versionada): el archivo nuevo `avisos-acceso.e2e.ts` no tiene errores de tipos; los dos errores que aparecen son preexistentes de `cotizacion-recalculo.e2e.ts` (`leer` y `modificar` sin uso).
- `pnpm docs:check`: OK (el cambio toca `apps/` y actualiza `docs/` y `.specify/bugs/`).
- `pnpm calidad`: `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` OK; `gitleaks` no corrió (necesita el daemon de Docker, no disponible en este entorno) → queda para el CI. Con `pnpm calidad:code` (sin Docker) el resumen es «Todo OK» con `gitleaks` saltado.
- E2E de evidencia: `apps/web/e2e/avisos-acceso.e2e.ts` (rótulo `[MSF-639:AVISOS]`, fixture de `apps/web/e2e/fixture.ts` para el video a 1920×1080 con cursor y rótulos). **Desvío de ejecución**: no se pudo correr en este entorno (sin daemon de Docker ni `pnpm dev:supabase`); se omite solo si faltan `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y aborta si `SUPABASE_URL` no es local. Se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e avisos-acceso`.
