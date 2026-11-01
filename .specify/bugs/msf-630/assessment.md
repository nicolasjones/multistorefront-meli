# Bug Assessment: Prompt del Documentador — Producto como manual de usuario con capturas (MSF-630)

- **Slug**: msf-630
- **Created**: 2026-11-01
- **Source**: pasted text ("[Tarea] Actualizar el prompt del Documentador para que Producto sea un manual de usuario con capturas (It's a Plan MSF-630)"); sin URL
- **Verdict**: likely valid, needs reproduction (la mitad orquestador ya está entregada; falta la mitad de este repo)
- **Severity**: medium

## Report (verbatim or summarized)

"[Tarea] Actualizar el prompt del Documentador para que Producto sea un manual de usuario con capturas". El historial de decisiones (`/opt/ai-dev-orchestrator/data/decisiones/MSF.md`) muestra MSF-630 pasando Backlog → Finalizada sin evidencia y reabierta a Ready For Spec: no había commit ni PR de este repo que mencionara MSF-630.

## Symptom

El Documentador generaba `docs/producto/` con claves de ticket, «Cómo probarlo» con rótulos de test y jerga técnica; se espera un manual de usuario para el cliente (segunda persona, sin jerga, con capturas). Desde el lado de este repo el manual no puede activarse.

## Reproduction

1. Mirar `/opt/ai-dev-orchestrator/prompts/documentador.md` (HEAD `master`): ya tiene la sección «Modo manual de usuario».
2. En este worktree: `ls docs/producto` → no existe; no hay `docs/producto/.manual-de-usuario`.
3. `pnpm docs:capturas`, `pnpm demo:dataset`, `apps/web/e2e/capturas/`, `docs/dataset-demo.md`: no existen (solo `pantallas:capturar` en `apps/web/package.json:13`, que es otra cosa: capturas del prototipo).
4. Consecuencia: el runner (`esManualDeUsuario`) cae al modo clásico; el prompt manda a usar scripts inexistentes.

## Suspected Code Paths

- `/opt/ai-dev-orchestrator/prompts/documentador.md:10-18` — modo manual ya presente (commit 59a7a9c9, PR #571 `feat/documentador-manual-de-usuario`, mergeado 2026-10-31/11-01). Copia desfasada sin el modo en `/home/agentes/orch-age1513/prompts/documentador.md`.
- `/opt/ai-dev-orchestrator/apps/worker/src/runners/documentador.js:23-29,61-62,94,171-174,211` — detección por marcador, filtro de jerga, cobertura solo en `docs/tecnico`; test `tests/documentador-manual.test.js`.
- Este repo (multistorefront-meli): falta el marcador `docs/producto/.manual-de-usuario`, la estructura `docs/producto/` + `docs/tecnico/`, el script `docs:capturas`, specs `apps/web/e2e/capturas/`, `pnpm demo:dataset` y `docs/dataset-demo.md`. `docs/` hoy es plano (`docs/*.md`, ej. `docs/guia-funcional.md`, `docs/documentacion-cambios.md`).

## Root Cause Hypothesis

La tarea se cerró sin evidencia (MSF-630 Finalizada sin PR enlazado): el cambio del prompt se entregó en el orquestador por otra rama (PR #571, sin la clave MSF-630 en commits), pero el contrato que el prompt asume en el repo del producto (marcador, carpetas, `docs:capturas`, dataset demo) nunca se creó aquí. El "bug" es una entrega incompleta/no trazada, no un defecto de lógica. Confianza: media-alta.

## Proposed Remediation

**Preferred**: (1) Trazar: vincular el PR #571 del orquestador a MSF-630 (nota/comentario con commit 59a7a9c9) y sincronizar la copia desfasada `orch-age1513` si se usa. (2) En este repo, vía spec (regla del proyecto: no inventar requisitos), preparar el contrato mínimo: crear `docs/producto/.manual-de-usuario` solo cuando exista la estructura `docs/producto|tecnico` + `mkdocs.yml` nav, y los scripts `docs:capturas` / `demo:dataset` con su doc. Mientras no existan, ajustar el prompt para que el paso de capturas diga «si el script no existe, dejar TODO con dueño» (ya lo cubre parcialmente).

**Alternatives**:
- Cerrar MSF-630 como entregada en el orquestador y abrir tarea `seguimiento` (Jira) por la parte del repo del producto (capturas/dataset). Menor costo; respeta la regla de tareas trazadas.

**Files likely to change**:
- `/opt/ai-dev-orchestrator/prompts/documentador.md` (solo si se ajusta el fallback de capturas)
- `docs/producto/.manual-de-usuario`, `docs/producto/README.md`, `mkdocs.yml`, `docs/dataset-demo.md`, `package.json` (`docs:capturas`, `demo:dataset`), `apps/web/e2e/capturas/*` — requieren spec previa

**Tests to add or update**:
- `tests/documentador-manual.test.js` (orquestador) ya cubre detección y jerga; añadir caso "prompt referencia script inexistente → TODO".
- `pnpm docs:check` en este repo tras cualquier cambio de docs.

## Risks & Considerations

- Activar el marcador sin páginas de producto reescritas hace que el runner bloquee el auto-merge por jerga en las páginas existentes.
- Capturas dependen de dataset demo reproducible y de e2e; no inventar imágenes.
- Cambios en este repo exigen documentación en el mismo cambio (`pnpm docs:check`) y spec con alcance de entrega.
- El árbol de `/opt/ai-dev-orchestrator` tiene cambios de datos sin commitear; no tocarlos.

## Open Questions

- [NEEDS CLARIFICATION: ¿el alcance de MSF-630 era solo el prompt (ya entregado en PR #571) o incluye preparar este repo (marcador, capturas, dataset)?]
- [NEEDS CLARIFICATION: ¿se sincroniza la copia `/home/agentes/orch-age1513/prompts/documentador.md`?]
