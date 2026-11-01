# Documentador: `docs/producto/` como manual de usuario (MSF-630)

El agente Documentador (repo del orquestador, `prompts/documentador.md` y
`apps/worker/src/runners/documentador.js`) escribe `docs/producto/` y
`docs/tecnico/` al cerrar cada épica. Desde MSF-630 el prompt tiene un
**modo manual de usuario** que se activa solo si existe el marcador
`docs/producto/.manual-de-usuario` en este repo (ya en `main` por PR #550).

## Contrato entre el orquestador y este repo

- **Producto**: segunda persona, paso a paso, sin claves de ticket/historia,
  specs, rutas, RPC, RLS ni rótulos de tests. Sin sección «Cómo probarlo».
- **Técnico**: toda la ingeniería va a `docs/tecnico/`, incluida la guía de
  prueba técnica. La clave de la épica (`MSF-XXX`) debe figurar ahí.
- **Guard**: el runner no mergea solo un PR con jerga en `docs/producto/`.
- **Capturas**: el prompt pide `pnpm docs:capturas`, `apps/web/e2e/capturas/` y
  `pnpm demo:dataset` (`docs/dataset-demo.md`). **Hoy esos artefactos no
  existen en este repo**: mientras tanto el Documentador deja un `TODO` con
  dueño en la página técnica, nunca una imagen inventada.

## Entrega y pendiente

- Prompt y runner: PR #571 del orquestador (commit `59a7a9c9`), verificado con
  `tests/documentador-manual.test.js` (4/4).
- Pendiente en este repo (requiere spec propia, no se inventa acá): scripts de
  capturas, dataset demo y specs `apps/web/e2e/capturas/`. Ver seguimiento
  trazado en el tracker.
