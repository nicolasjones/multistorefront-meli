# Bug Fix: el `tasks.md` de las specs entregadas nunca se cerraba (630 tareas `[ ]`)

- **Slug**: msf-914
- **Fixed**: 2026-11-21
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El `tasks.md` es la fuente de verdad que leen los consumidores (manifiesto de cobertura
E2E y cobertura de épicas) y la regla del repo («ninguna tarea `[ ]` queda sin hacer»)
no era verificable: el orquestador deja las marcas de cada historia en su side-car
`specs/<slug>/tasks/<HISTORIA>.md` —por diseño no edita el `tasks.md`, que es la spec
compartida— y nadie las volcaba. Se agrega un consolidador determinista e idempotente
que proyecta al `tasks.md` **sólo** las marcas que ya existen en un side-car, un gate
(`pnpm tareas:check`) que falla si una historia cerrada dejó una tarea atrás, y se
consolida la deuda acumulada: **1038 tareas de 36 specs**.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/consolidar-marcas-tasks.mjs` | added | Vuelca al `tasks.md` sólo las marcas `[x]` de un side-car. No inventa marcas, nunca vuelve `[x]` a `[ ]`, deja intacto el texto de la línea, es idempotente y deja la procedencia (`Evidencia: marca de cierre en \`tasks/<HISTORIA>.md\``). Reconoce el id con o sin negrita (`- [ ] T001` / `- [ ] **T001**`). `--dry-run` no escribe. |
| `scripts/consolidar-marcas-tasks.test.mjs` | added test | 9 casos: vuelca la marca, la vuelca también con el id en negrita, no cierra lo no marcado, no toca lo ya `[x]`, idempotencia, no duplica la evidencia, lee todos los side-car. |
| `scripts/verificar-tareas-cerradas.mjs` | added | Gate: por cada tarea `[ ]` falla si un side-car la marcó (falta consolidar), si sigue `[ ]` con una nota real de `Desvío:` (la deuda trazada se cierra como `[x]`) o si la historia que la posee se cerró y la dejó sin marcar. La historia se resuelve por el side-car homónimo, así que cubre `[F-XXX-NN]`, `[F-1]`, `[US-A]`, `[US-B1]`, `[US-1]`, `[CIERRE]` y `[MSF-NNN]`; cada fallo imprime su acción. |
| `scripts/verificar-tareas-cerradas.test.mjs` | added test | 17 casos: falla con side-car marcado, pasa consolidado, falla con `[ ]` + `Desvío:` (y no confunde un `Desvío:` citado dentro del texto), falla con historia cerrada y tarea atrás, reconoce las etiquetas en vuelo por su side-car, ve el id en negrita y recorre todos los specs. |
| `package.json` | modified | `tareas:consolidar`, `tareas:check`, `test:tareas:cerradas`; `pnpm test` corre el gate y sus tests. |
| `.github/workflows/validate.yml` | modified | El job `chequeos` corre `pnpm tareas:check` y `pnpm test:tareas:cerradas`. |
| `specs/*/tasks.md` (36 specs) | modified | Consolidación: 1038 tareas `[ ]` → `[x]` con su procedencia. No se editó a mano ninguna marca: todas salen de un side-car. |
| `AGENTS.md`, `CLAUDE.md` | modified | La regla absoluta deja de afirmar «el sistema lo garantiza» y dice **cómo se verifica** (side-car → `pnpm tareas:consolidar` → gate `pnpm tareas:check`). |
| `.agents/skills/speckit-implement/SKILL.md`, `.claude/skills/speckit-implement/SKILL.md`, `.opencode/commands/speckit.implement.md` | modified | La post-condición «Done When» exige el estado verificable (`pnpm tareas:check` en verde), no sólo la intención de marcar. |
| `docs/tecnico/cierre-de-tareas.md` | added | Guía del mecanismo: side-car, consolidación, gate, reglas (incluida la deuda trazada que se cierra como `[x]`) y qué hacer cuando una tarea no se puede hacer. |
| `docs/README.md`, `mkdocs.yml` | modified | La página nueva entra al índice y al nav de MkDocs. |
| `docs/manifest.json`, `docs/_generated/inventory.{json,md}` | modified | Manifest e inventario regenerados con `node scripts/docs-manifest.mjs` / `node scripts/docs-inventario.mjs` sobre el árbol final (el `sourceAt` de la página nueva ya no queda `null`). |
| `.specify/bugs/msf-914/assessment.md` | added | Evaluación del bug (`.specify/bugs/msf-914/`). |

## Diff Highlights

```diff
-- [ ] T001 [F-TDA-11][US1] Migración `supabase/migrations/20261023150000_tienda_categorias_publicas.sql`: …
+- [x] T001 [F-TDA-11][US1] Migración `supabase/migrations/20261023150000_tienda_categorias_publicas.sql`: … Evidencia: marca de cierre en `tasks/F-TDA-11.md`.
```

```js
// scripts/verificar-tareas-cerradas.mjs — la regla que el repo declaraba y nadie comprobaba
if (marcas.has(tarea.id)) { /* falta consolidar */ }
if (tieneDesvio(tarea.entrada)) { /* sigue [ ]: la deuda trazada se cierra */ }
const historia = historiaDe(tarea.linea, sideCars); // cubre [F-1], [US-A], [US-1]…
if (historia && sideCars.has(historia)) { /* historia cerrada, tarea atrás */ }
```

## Tests Added or Updated

- `scripts/consolidar-marcas-tasks.test.mjs` — el consolidador vuelca sólo lo marcado en
  side-car (con id normal o en negrita), nunca toca una tarea ya cerrada, es idempotente y
  no duplica la evidencia.
- `scripts/verificar-tareas-cerradas.test.mjs` — el gate falla con una historia cerrada y
  una tarea sin marcar, falla con `[ ]` + `Desvío:` (la deuda trazada debe cerrarse),
  reconoce las etiquetas en vuelo por su side-car homónimo y pasa con historias en curso.

## Local Verification

- `node --test scripts/consolidar-marcas-tasks.test.mjs scripts/verificar-tareas-cerradas.test.mjs` → 26 tests, 26 pass.
- `node scripts/verificar-tareas-cerradas.mjs` → `Cierre de tareas: OK (87 tareas abiertas de historias en curso, 0 sin cerrar)`.
- `node scripts/consolidar-marcas-tasks.mjs --dry-run` → `0 tareas cerradas en 0 specs` (la proyección está completa y es idempotente).
- `node scripts/verificar-tareas-cerradas.mjs --specs <árbol de origin/dokploy>` → **falla** con `1037 tareas de 36 specs`: la deuda que el bug reportaba es detectable (reproducción del síntoma).
- `pnpm lint` → exit 0 (warnings preexistentes de `apps/web`).
- `pnpm build` → exit 0.
- `pnpm docs:check` → `Documentación de cambios: OK`, `Migraciones OK: 771 archivo(s), 0 nuevo(s)`.
- `node scripts/docs-check.mjs` → `nav: 220 páginas`, `links internos: 2006`, `Documentación OK`.
- `node scripts/docs-manifest.mjs` y `node scripts/docs-drift.mjs` → manifest regenerado; drift sin páginas desactualizadas.
- `pnpm calidad:code` → `Todo OK` (gitleaks saltado: sin Docker en este entorno).

## Deviations from Assessment

- **Los consumidores (`scripts/cobertura-e2e.mjs`, `scripts/e2e-cobertura-epicas.py`) no
  cambiaron.** El assessment los listaba como «probable cambio»; no lo necesitan: leen el
  `tasks.md`, y con el `tasks.md` consolidado ya ven el estado real (antes veían `[ ]`
  para historias entregadas). No había que duplicar la lógica de resolución.
- **No se hizo el triaje manual de las 3 specs sin side-car** (18 tareas). Sus historias
  no se cerraron y su texto dice que el trabajo está pendiente o a la espera de un hito
  (`F-TDA-26`, `F-TDA-27`, `F-CLI-20`, `F-CLI-21`, `F-PRV-09`, `US-A`, `US-B1`,
  `F-GAS-01`–`F-GAS-03`, `F-OPI-01`–`F-OPI-03`, `F-PRE-14`): no hay respaldo para
  marcarlas y marcarlas sería falsificar la auditoría. Quedan `[ ]` y el gate no las
  marca, porque su historia sigue abierta. Se documentan en
  `docs/tecnico/cierre-de-tareas.md`.
- **El corte del reporte (21 specs / 630 tareas) no es reproducible localmente**: depende
  del estado «Finalizada» del tracker It's a Plan (sin `ITSAPLAN_API_KEY`). El alcance
  medido en el repositorio es mayor: **45 specs con 1125 tareas `[ ]`** sobre `dokploy`.

## Follow-ups

- El gate depende de que el orquestador siga escribiendo el side-car al cerrar una
  historia. Si en el futuro escribe directo en el `tasks.md`, el consolidador queda sin
  efecto (es idempotente: no rompe) y el gate sigue sirviendo de red.
- Las 87 tareas `[ ]` restantes (10 specs) se cierran cuando sus historias se cierren y
  el orquestador escriba su side-car; `pnpm tareas:consolidar` las proyecta sin tocar
  nada más.
