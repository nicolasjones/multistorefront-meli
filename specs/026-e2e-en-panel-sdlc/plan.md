# Plan: sacar el visor de MSF

1. **Quitar, no ocultar.** Se eliminan la ruta, las páginas y los tests del
   visor en `apps/web`; el menú de Refine deja de declarar el recurso.
2. **El manifiesto queda como artefacto.** El CI sigue generándolo; el panel
   SDLC lo importa (`gh run download`) y sirve los videos desde un volumen.
3. **Un solo lugar.** El panel SDLC agrega la vista `?v=e2e` y el runner local
   (`tools/e2e-runner/`), que también existe en este repo por historia, se mueve
   al repo del panel.
4. **Sin secretos en MSF.** Se borran las variables del bucket del workflow y
   los secretos del repo.

## Verificación

- `pnpm lint`, `build`, `test:web`, `docs:check`, `matriz:check`.
- `curl /cobertura-e2e` en el preview: 404 (SPA sin ruta).
- Panel SDLC: `?v=e2e` con video y «Correr» funcionando.
