# Fix: MSF-630 — Documentador y manual de usuario

- **Slug**: msf-630
- **Tipo de remediación**: trazabilidad + documentación (el cambio de prompt ya estaba entregado fuera de este repo)

## Qué se hizo
- Verificado que `prompts/documentador.md` del orquestador (commit `59a7a9c9`, PR #571) ya define el modo manual: producto en lenguaje de usuario, sin claves/jerga, sin «Cómo probarlo», técnica solo en `docs/tecnico/`, capturas con `docs:capturas`.
- Verificado que el marcador `docs/producto/.manual-de-usuario` existe en `origin/main` (PR #550).
- Agregado `docs/documentador-manual-de-usuario.md` con el contrato y el pendiente.

## Qué NO se hizo (y por qué)
- No se crearon `docs:capturas`, `demo:dataset`, `apps/web/e2e/capturas/` ni `docs/dataset-demo.md`: son funcionalidad nueva que exige spec (regla del proyecto: no inventar requisitos). Queda como seguimiento MSF-646 (Tarea `seguimiento` en el tracker, con dueño); el prompt ya cubre la ausencia con un `TODO`.
- No se tocó el repo del orquestador (tiene cambios de datos sin commitear).

## Reversión
Borrar `docs/documentador-manual-de-usuario.md` y `.specify/bugs/msf-630/`.
