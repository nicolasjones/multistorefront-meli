---
owner: plataforma
sources: []
---
# Documentador: `docs/producto/` como manual de usuario (MSF-630)

El agente Documentador (repo del orquestador, `prompts/documentador.md` y
`apps/worker/src/runners/documentador.js`) escribe `docs/producto/` y
`docs/tecnico/` al cerrar cada épica. Desde MSF-630 el prompt tiene un
**modo manual de usuario** que se activa solo si existe el marcador
`docs/producto/.manual-de-usuario` en este repo (presente también en esta rama: `docs/producto/.manual-de-usuario`).

## Contrato entre el orquestador y este repo

- **Producto**: segunda persona, paso a paso, sin claves de ticket/historia,
  specs, rutas, RPC, RLS ni rótulos de tests. Sin sección «Cómo probarlo».
- **Técnico**: toda la ingeniería va a `docs/tecnico/`, incluida la guía de
  prueba técnica. La clave de la épica (`MSF-XXX`) debe figurar ahí.
- **Guard**: el runner no mergea solo un PR con jerga en `docs/producto/`.
- **Capturas**: el prompt pide `pnpm docs:capturas`, `apps/web/e2e/capturas/` y
  `pnpm demo:dataset` (`docs/dataset-demo.md`). Esos artefactos **ya existen en
  este repo** (`package.json`: `docs:capturas` y `demo:dataset`; specs en
  `apps/web/e2e/capturas/*.capturas.ts`; config `apps/web/playwright.capturas.config.ts`).
  Las capturas necesitan el stack local con el dataset demo; si no se puede
  levantar, el Documentador deja un `TODO` con dueño, nunca una imagen inventada.
  Regla de proceso y estado: sección «Capturas del manual» de
  `docs/documentacion-cambios.md`.

## Entrega y pendiente

- Prompt y runner: PR #571 del orquestador (commit `59a7a9c9`), verificado con
  `tests/documentador-manual.test.js` (4/4).
- Los scripts de capturas, el dataset demo y los specs `apps/web/e2e/capturas/`
  que este documento daba por pendientes (MSF-646) ya están en el repo.
