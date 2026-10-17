# Fix: MSF-509 — cierre MSF-162 (T005, T006, T007)

- **Slug**: msf-509
- **Status**: applied
- **Assessment**: ./assessment.md

## Changes

| File | Change | Notes |
|------|--------|-------|
| `docs/roadmap-template.md` | modified | fila «Alta de nuevas organizaciones (F-ORG-02)» → Implementado (T007) |
| `docs/alta-de-organizaciones.md` | sin cambio | T005 ya cubierto por la guía existente (ver commit 63f4f09) |
| `specs/20261016-130000-organizaciones-nuevas/tasks/MSF-509.md` | added | marcas T005–T007 (el runner las escribe; `tasks.md` no se edita) |

## Local Verification

- `pnpm lint`, `pnpm build`, `pnpm docs:check` → OK.
- `pnpm test` → paquetes JS verdes; `supabase test db` (pgTAP) no corre aquí (sin permiso al socket de Docker); queda para el CI.
- Migraciones: ninguna. Sin tablas nuevas (Principio VII: no aplica).
- T007: el merge `--no-ff` lo hace el cierre del PR; la fila ya queda en el PR.
