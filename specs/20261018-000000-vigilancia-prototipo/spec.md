# Spec: Vigilancia del prototipo (fidelidad mecánica, no de palabra)

**Estado**: implementada
**Alcance de entrega**: `refine` (tooling/CI); no toca Supabase, Kestra, Superset ni workers.

## Problema

El prototipo `design/pantallas/*.dc.html` es la fuente de verdad de la UI
(`docs/prototipos.md`), pero su fidelidad dependía de que el agente **corriera el
inventario a mano** y **leyera** `docs/prototipos.md`. No había gate en CI: sólo
4 de 120 pantallas tenían `.inventory.json` commiteado, las instrucciones de los
agentes no nombraban el prototipo y no existía chequeo de la matriz en la spec.

## Criterios de aceptación

- **CA-1** `pnpm prototipo:check` falla si un `design/pantallas/**/*.dc.html` no
  tiene su `.inventory.json` o quedó desfasado; y pasa con las 120 pantallas.
- **CA-2** `pnpm prototipo:inventario` regenera todos los inventarios de una.
- **CA-3** `pnpm matriz:check` exige `## Matriz pantalla↔criterios` en toda spec
  **nueva** que mencione pantallas o un prototipo.
- **CA-4** La regla del prototipo vive en `AGENTS.md`, `CLAUDE.md` y en las skills
  `frontend-design`, `mui-refine` y `refine-frontend` (ambas copias: `.agents` y
  `.claude`).
- **CA-5** El CI (`.github/workflows/validate.yml`, job `application`) corre los
  dos checks y sus tests.
- **CA-6** Existe una herramienta de comparación lado a lado documentada
  (`pnpm --filter @platform/web pantallas:capturar`).

## Fuera de alcance (explícito)

- **Visual regression automático (diff de píxeles)**: descartado como gate. Los
  datos reales y las fuentes varían entre entornos y daría falsos negativos. Se
  entrega la captura para revisión humana.
- **Aplicar la matriz de forma retroactiva** a specs ya mergeadas: no se hace
  para no romper historial; el gate aplica a specs nuevas del rango del PR.

## Matriz pantalla↔criterios

**No aplica**: esta spec no implementa ni modifica pantallas (es, precisamente,
la vigilancia de que las demás lo hagan fiel). No hay prototipo a mapear.

## Decisiones

- Un único generador canónico (`scripts/prototipo-inventario.mjs`, determinista,
  sin LLM) y un verificador que reusa su función `inventariar()` para no divergir.
- El check de matriz se limita a specs **nuevas** (`--diff-filter=A`) para ser
  seguro por defecto.
- `design/` sale del clasificador `code`/`web` del CI: cambiar un prototipo no
  debe disparar el build ni la suite web, pero **sí** corre `prototipo:check`.
