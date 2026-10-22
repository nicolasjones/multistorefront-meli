# Plan: Vigilancia del prototipo

## Enfoque

Tooling puro en `scripts/` + wiring de CI + reglas de instrucciones. Sin cambios
de producto (no toca pantallas, rutas ni permisos).

## Componentes

1. `scripts/verificar-inventario-prototipo.mjs` — reusa `inventariar()` de
   `scripts/prototipo-inventario.mjs`; verifica/regenera los `.inventory.json`.
2. `scripts/verificar-matriz-pantalla.mjs` — mira specs **nuevas** del rango y
   exige `## Matriz pantalla↔criterios` cuando la spec menciona UI.
3. Ambos con tests `node:test` (`*.test.mjs`).
4. Aliases en `package.json` y `apps/web/package.json`.
5. Wiring en `.github/workflows/validate.yml` (job `application`).
6. Regla en `AGENTS.md`, `CLAUDE.md` y skills UI.
7. `docs/prototipos.md` con los gates.
8. `apps/web/scripts/capturar-pantallas.mjs` (captura lado a lado, no gate).
9. Generar y commitear los inventarios faltantes.

## Riesgos

- El check de inventario obliga a regenerar al tocar cualquier `.dc.html`: es
  intencional (evita que el prototipo cambie por detrás de la implementación).
- El check de matriz podría dar falso positivo si una spec menciona un path de
  UI sin ser una spec de pantalla: se acota a specs nuevas y se documenta.
