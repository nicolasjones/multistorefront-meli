# Verificación: MSF-504

- Premisa verificada contra git: la épica (`d9a1b5f`) contiene M1 (`20261016130000_…`) y M3 (`20261016130200_…`); T002 `[x]` en `specs/20261016-130000-clientes-alta-y-busqueda/tasks.md`.
- `git rev-list --left-right --count HEAD...origin/feat/story-MSF-301` → `10 7` (la rama de MSF-301 está desfasada).
- Sin código tocado: no aplican lint/build/tests (solo se agregan informes en `.specify/bugs/msf-504/`).
- Pendiente (MSF-301): M2, pgTAP/Vitest y T013, con CI.
