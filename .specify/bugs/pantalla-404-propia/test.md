# Bug Test: Pantalla 404 en inglés y sin estilo

- **Slug**: pantalla-404-propia
- **Result**: verified

## Verification

- `vitest run src/pages/no-encontrada` → 2/2 passed.
- `pnpm lint` → sin hallazgos nuevos (solo advertencias previas).
- `pnpm build` → OK.
- E2E: no aplica; la ruta `*` está tras sesión y el E2E de acceso público no tiene fixtures de sesión (ver `docs/e2e-app.md`).
