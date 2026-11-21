# Bug Verification: el `tasks.md` de las specs entregadas nunca se cerraba (630 tareas `[ ]`)

- **Slug**: msf-914
- **Tested**: 2026-11-21
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (specs de épicas ya entregadas con cientos de tareas `[ ]`) **no se reproduce**:
sobre la rama, el `tasks.md` refleja las marcas que el orquestador dejó en los side-car
(1038 tareas de 36 specs cerradas) y el gate nuevo `pnpm tareas:check` pasa. El mismo gate
**falla** sobre el árbol de `origin/dokploy` con `1038 tareas de 36 specs`, o sea que la
deuda del reporte es detectable y el mecanismo la cierra. Las 87 tareas `[ ]` que quedan
pertenecen a historias que no se cerraron: no hay respaldo para marcarlas.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node scripts/verificar-tareas-cerradas.mjs --specs <origin/dokploy>` | fail (esperado) | Sobre el árbol de la base el gate falla: `1038 tareas de 36 specs` — el bug es detectable. |
| Reproduction (post-fix, rama) | `node scripts/verificar-tareas-cerradas.mjs` | pass | `Cierre de tareas: OK (87 tareas abiertas de historias en curso, 0 sin cerrar).` |
| New / updated tests | `node --test scripts/consolidar-marcas-tasks.test.mjs scripts/verificar-tareas-cerradas.test.mjs` | pass | 29 tests, 29 pass, 0 fail. |
| New / updated tests | `node --test scripts/cobertura-e2e.test.mjs` | pass | 9 tests, 9 pass, 0 fail. |
| Idempotencia | `node scripts/consolidar-marcas-tasks.mjs --dry-run` | pass | `0 tareas cerradas en 0 specs` — la proyección está completa y no vuelve a tocar nada. |
| Alcance del cierre | `grep -E '^\s*[-*]\s*\[ \]' specs/*/tasks.md` | pass | Antes (base): 45 specs / 1125 tareas. Después: 10 specs / 87 tareas (todas de historias en curso). |
| Drift de docs | `node scripts/docs-drift.mjs` | fail (esperado) | exit 1 con 129 páginas (la base `bf4ee7455` traía 11; este PR agrega 118). El drift se rebasa en el PR del Release (`dokploy` → `main`), según `docs/documentacion-cambios.md`. |
| Regression suite | `pnpm lint` | pass | exit 0 (los warnings de `apps/web` son preexistentes y ajenos al cambio). |
| Regression suite | `pnpm build` | pass | exit 0. |
| Regression suite | `pnpm docs:check` | pass | `Documentación de cambios: OK`, `Migraciones OK: 771 archivo(s), 0 nuevo(s) contra origin/dokploy`. |
| Regression suite | `node scripts/docs-check.mjs` | pass | `nav: 220 páginas`, `links internos: 2006`, `Documentación OK`. |
| Lint / type-check | `pnpm calidad:code` | pass | `Todo OK` (gitleaks saltado: sin Docker en este entorno). |
| E2E | — | not-run | La historia no tiene criterios de aceptación de pantalla: no toca `apps/web` ni la base. |

## Output Excerpts

```
$ node scripts/verificar-tareas-cerradas.mjs --specs <árbol de origin/dokploy>
…
Fallo de cierre de tareas: 1038 tareas de 36 specs. Seguí la acción indicada en cada una.
(exit 1)

$ node scripts/verificar-tareas-cerradas.mjs
Cierre de tareas: OK (87 tareas abiertas de historias en curso, 0 sin cerrar).
(exit 0)

$ node scripts/consolidar-marcas-tasks.mjs --dry-run
Consolidación (simulada): 0 tareas cerradas en 0 specs · 87 sin respaldo (historias abiertas).

$ node --test scripts/consolidar-marcas-tasks.test.mjs scripts/verificar-tareas-cerradas.test.mjs
ℹ tests 29
ℹ pass 29
ℹ fail 0

$ node --test scripts/cobertura-e2e.test.mjs
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

## Residual Risks

- **La proyección depende del side-car.** Si el orquestador dejara de escribir
  `specs/<slug>/tasks/<HISTORIA>.md`, el gate no detectaría una historia cerrada sin
  marca. Hoy el side-car es el único aviso de cierre; el gate lo asume por diseño (lo
  documenta `docs/tecnico/cierre-de-tareas.md`).
- **Falsa auditoría si un side-car marca de más.** La consolidación proyecta lo que el
  side-car afirma; cada línea cerrada deja su procedencia (`Evidencia: marca de cierre en
  \`tasks/<HISTORIA>.md\``) para poder auditarla línea a línea.
- **Las 87 tareas `[ ]` restantes no se verificaron una por una.** Son de historias que no
  se cerraron (`F-TDA-26`, `F-TDA-27`, `F-VTA-33`, `F-CLI-20`, `F-CLI-21`, `F-PRV-09`,
  `F-PRE-14`, `F-GAS-01`–`F-GAS-03`, `F-OPI-01`–`F-OPI-03`, `US-*` y las fases `[CIERRE]`
  de esas specs). Se cierran cuando su historia se cierre; el gate no las marca.
- **El drift de docs marca 129 páginas con este cambio** (`node scripts/docs-drift.mjs` → exit 1):
  la base `bf4ee7455` ya traía 11 y este PR agrega 118 (94 por el `tasks.md` de las 36 specs
  consolidadas y 24 por `package.json`, `validate.yml`, `AGENTS.md` y `mkdocs.yml`). No es una
  regresión: el workflow de docs corre sólo en PRs hacia `main`, no hacia `dokploy`
  (`.github/workflows/docs.yml:1-8`) y el drift se rebasa en el PR del Release
  (`dokploy` → `main`), según `docs/documentacion-cambios.md`. Para esta página, el manifest y
  el inventario se regeneran y se commitean sobre el árbol final, así que su `sourceAt` ya no
  queda `null`.
- **El corte «21 specs / 630 tareas» del tracker no se reprodujo**: depende del estado
  «Finalizada» de It's a Plan (sin `ITSAPLAN_API_KEY`). El alcance medido en el
  repositorio es mayor (45 specs / 1125 tareas antes de este cambio).

## Recommendation

Cerrar el bug — verificado de punta a punta: la deuda del reporte es detectable por el
gate, la consolidación la cierra (1038 tareas, 36 specs) de forma determinista e
idempotente, y el árbol queda en verde con el gate. Queda pendiente, ya trazado en
`fix.md`, el cierre de las 87 tareas de historias que todavía no se cerraron.
