# Bug Assessment: 630 tareas `[ ]` abiertas en 21 specs de épicas YA entregadas — el `tasks.md` nunca se cierra

- **Slug**: msf-914
- **Created**: 2026-11-14T19:20:31Z
- **Source**: pasted text — It's a Plan (tracker `MSF`), issue MSF-914
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> `[Auditoría] 630 tareas `[ ]` abiertas en 21 specs de épicas YA entregadas: el `tasks.md` nunca se cierra (It's a Plan MSF-914) slug=msf-914`

Sin URL: no aplica URL Trust Policy (no hay URL en el reporte). La fuente declarada es el tracker It's a Plan (`ITSAPLAN_API_URL` por defecto `https://api.plan.agenmatica.com`, proyecto `MSF`), documentado en `scripts/e2e-cobertura-epicas.py:24-26`.

## Symptom

Al cerrar (merge) el PR de una épica, el `tasks.md` de la spec conserva sus tareas con la casilla `- [ ]` sin marcar, aunque el trabajo esté hecho y revisado. El resultado es que specs de épicas ya entregadas quedan con cientos de tareas abiertas, en contra de la «regla absoluta» del repo.

Esperado: al cerrarse la épica, ninguna tarea de `tasks.md` queda `[ ]` — o se marca `[x]` con evidencia, o se cierra con `[x]` + nota `Desvío:` y seguimiento trazado.

## Reproduction

1. Abrir `specs/20261023-120000-tienda-catalogo-y-ficha/tasks.md`: las 40 tareas (`T001`–`T073`) figuran con `- [ ]`.
2. Abrir `specs/20261023-120000-tienda-catalogo-y-ficha/tasks/`: `F-TDA-11.md`, `F-TDA-12.md`, `F-TDA-13.md`, `F-TDA-18.md`, `CIERRE.md` marcan `[x]` las 40 mismas tareas (`T001`–`T073`), con la nota «Las tareas de **esta** historia quedaron hechas (la historia está **Finalizada**). Se reconcilia por si el Revisor no las marcó».
3. Constatar que `tasks.md` nunca recibió esas marcas: la épica está entregada (`docs/roadmap-template.md`, sección «Backlog entregado») y el `tasks.md` sigue con 40 casillas `[ ]`.
4. Confirmar que no existe ninguna automática que lo corrija: no hay script, hook, paso de CI ni `pnpm` que volque las marcas del side-car al `tasks.md` (ver *Suspected Code Paths*).
5. Medir el alcance: 41 specs de 146 con tareas `[ ]`, 1099 tareas abiertas; 36 de esas specs tienen **todas** sus tareas abiertas ya marcadas `[x]` en el side-car (1054 tareas) — lo único que falta es la consolidación.

Corte reproducible por filtro (repo, sin acceso al tracker):

| Filtro | Specs | Tareas `[ ]` |
|---|---|---|
| Todas las specs con `[ ]` | 41 | 1099 |
| Con side-car `tasks/<HISTORIA>.md` | 38 | 1081 |
| Side-car cubre **todas** las abiertas (solo falta consolidar) | 36 | 1054 |
| Con side-car y **cero** `[x]` volcado alguna vez | 29 | 876 |
| Sin side-car (requieren triaje manual) | 3 | 18 |

Ejemplos representativos: `20261024-130000-stock-carga-exportacion-y-avisos` (52 abiertas), `20261022-084830-tienda-dominio-e-identidad` (43), `20261023-100000-ventas-comprobantes` (41), `20261024-130000-ventas-listado-estados-y-anulacion` (41), `20261023-120000-tienda-catalogo-y-ficha` (40).

## Suspected Code Paths

- `AGENTS.md:39` y `CLAUDE.md:40` — enuncian la «regla absoluta» y **afirman un control que no existe**: «El sistema lo garantiza: el release de la épica no avanza con tareas `[ ]`, el cierre se despacha solo y la deuda post-release se traza». No hay ningún componente que lo garantice.
- `.agents/skills/speckit-implement/SKILL.md:172` (y `:223`) — única instrucción del repo que tilda una casilla: «**IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file». Es una instrucción en lenguaje natural al LLM, sin post-condición verificable. Réplicas: `.claude/skills/speckit-implement/SKILL.md:175` (`:226`) y `.opencode/commands/speckit.implement.md:165` (`:215`).
- `.specify/bugs/msf-509/fix.md:13` — evidencia explícita del diseño que provoca el bug: «`specs/…/tasks/MSF-509.md` | added | marcas T005–T007 (**el runner las escribe; `tasks.md` no se edita**)». El orquestador escribe las marcas en side-cars y por diseño no toca el `tasks.md`.
- `specs/<spec>/tasks/<HISTORIA>.md` (66 directorios; 37 con `CIERRE.md`) — destino real de las marcas. Ejemplo: `specs/20261023-120000-tienda-catalogo-y-ficha/tasks/CIERRE.md` («# Marcas de CIERRE (reconciliado, BUG-143)»).
- `scripts/e2e-cobertura-epicas.py:151-153` y `:183` — **consumidor afectado**: lee el estado de las casillas del `tasks.md` y recién considera una historia cubierta si `all(t["hecha"] for t in ts_h)`. Con el `tasks.md` desactualizado, la cobertura E2E de la épica reporta como no hecha trabajo ya entregado.
- `scripts/cobertura-e2e.mjs:19` y `:131` — mismo patrón (`hecho: m[1].toLowerCase() === 'x'`): el manifiesto de evidencia E2E hereda el estado obsoleto.
- `scripts/e2e-evidencia.sh:67` — `grep -oE '^\s*-\s*\[[ xX]\]\s*T[0-9]+'` sobre `tasks.md`: toma la lista de tareas del `tasks.md`, no del side-car.
- `.specify/extensions.yml:9-186` — registro de hooks: solo `git` (initialize/feature/commit) y `agent-context`. **No hay** hook `before_implement`/`after_implement` que cierre tareas, ni ningún otro.
- `.specify/workflows/speckit/workflow.yml:7,43-78` — flujo `specify → plan → tasks → implement` con gates de revisión de spec/plan; **no hay** gate de cierre de tareas.
- Ausencia de gate (verificado por búsqueda en `scripts/`, `.github/workflows/`, `package.json`): ningún `.mjs`/`.ts`/`.py`/`.sh`/`.yml` del repo lee `tasks.md` para exigir cero `[ ]`. Los únicos hits de `[x]` en código son `scripts/cobertura-e2e.test.mjs:18`, un fixture. Ningún `pnpm` script (`docs:check`, `der:check`, `matriz:check`, `prototipo:check`, `ui:empresas:check`) audita el estado de las tareas.
- `specs/20261024-130000-stock-carga-exportacion-y-avisos/estado/MSF-566.md:141` — **precedente del mismo modo de falla ya documentado**: «Las marcas de T050–T052 no existían … en `tasks.md` (spec compartida) T050–T052 seguían como `[ ]` … el release de la épica no avanza con tareas abiertas». Se corrigió a mano, spec por spec, sin cerrar el mecanismo.
- `specs/20261022-100000-service-listado-items-e-impresion/tasks.md:63` — la propia tarea de cierre sigue abierta: «T033 [CIERRE] … comprobar que ninguna tarea queda `[ ]`». El guardián de la regla es él mismo una tarea sin tildar.

Historial de consolidación — **manual, caso por caso** (nunca automatizada):

- `26990201` `chore(tasks): consolidar las marcas del cierre de MSF-192 en el tasks.md`
- `d7d6f870` `chore(tasks): consolidar las marcas del cierre de MSF-140 en el tasks.md`
- `625c1d29` `chore(tasks): sincronizar marcas de tasks.md con tasks/<HISTORIA>.md tras el merge de dokploy`
- `64252050` — precedentó el modo de falla: tocò **solo** el side-car, no el `tasks.md` («tareas no tildadas trababan la cadena»).

## Root Cause Hypothesis

**Confianza: alta.** El `tasks.md` no tiene un dueño de escritura. Hay tres actores y ninguno cierra el ciclo:

1. **El implementador** (`speckit-implement`) *debería* tildar al completar cada tarea, pero solo hay una instrucción en lenguaje natural (`SKILL.md:172`) sin post-condición: en la práctica el agente completa el código y deja las casillas como están (los aprendizajes repetidos del repo — T020–T025, T001–T009, T030–T032 — son el mismo symptom).
2. **El orquestador externo** (SDLC en VPS1; `docs/tecnico/operacion.md:14`) es quien realmente conoce el estado: escribe las marcas en `specs/<spec>/tasks/<HISTORIA>.md` cuando la historia pasa a «Finalizada». **Por diseño no edita el `tasks.md`** (`msf-509/fix.md:13`), para no pisar el archivo que edita el implementador.
3. **La consolidación** (side-car → `tasks.md`) es un commit manual que se hizo 2–3 veces en toda la historia del repo (`26990201`, `d7d6f870`, `625c1d29`). No hay script, hook, paso de CI ni `pnpm` que la ejecute.

La causa raíz no es un bug de código sino **un hueco de proceso con una invariante declarada y no verificada**: `AGENTS.md:39` afirma que «el sistema lo garantiza» y el release «no avanza con tareas `[ ]`», pero ningún sistema lo comprueba ni lo hace. La consecuencia observable es doble: (a) el `tasks.md` — la fuente de verdad que leen los consumidores — queda congelado en `[ ]`; (b) `scripts/e2e-cobertura-epicas.py:183` y `scripts/cobertura-e2e.mjs:131` leen esas casillas, así que la **evidencia de cobertura E2E de la épica reporta como no entregada** historia ya terminada — el defecto no es cosmético, corrompe la evidencia de release.

El corte «21 specs / 630 tareas» del reporte depende del estado «Finalizada» en el tracker; sin `ITSAPLAN_API_KEY` no es reproducible localmente, pero bajo cualquier definición razonable del corte el alcance es **mayor**: 41 specs / 1099 tareas abiertas en el árbol, 36 de ellas ya marcadas `[x]` en side-cars.

## Proposed Remediation

**Preferred**: cerrar el ciclo de escritura del `tasks.md` con un artefacto único y verificable, en tres piezas.

**(1) Consolidación determinista, idempotente y auditable.** Un script nuevo (p. ej. `scripts/consolidar-marcas-tasks.mjs`, con test en `scripts/consolidar-marcas-tasks.test.mjs`) que, para cada `specs/<spec>/tasks.md`, cruce sus casillas `- [ ]` con las marcas `[x]` de `specs/<spec>/tasks/*.md` y **vuelque al `tasks.md` solo las tareas ya marcadas en el side-car**, preservando el texto, la evidencia y las notas `Desvío:` de la línea original. Reglas: nunca pasar `[x]` → `[ ]`; nunca inventar marcas; ser idempotente; reportar por spec cuántas cerró y cuáles quedaron sin respaldo (esas son la deuda real). Los side-car pasan a ser la fuente de verdad y el `tasks.md`, su proyección consolidada.

**(2) Un gate que haga verdadera la regla.** Un chequeo nuevo (p. ej. `pnpm tareas:check`) que falle si una spec con fase `[CIERRE]` cerrada conserva `[ ]`, cableado en `.github/workflows/validate.yml`. Debe tolerar (a) los side-car aún no consolidados (primero se consolida y después se exige) y (b) la deuda trazada con `Desvío:` + seguimiento, para no bloquear el release por deuda ya registrada — que es justamente lo que la regla ya prevêée.

**(3) Corregir la afirmación falsa de la documentación.** `AGENTS.md:39` y `CLAUDE.md:40` deben dejar de afirmar que «el sistema lo garantiza» mientras no haya tal sistema, o —preferido— describir el gate real una vez implementado (paso 2). Sin este punto, la documentación sigue prometiendo una garantía inexistente y el próximo agente que lea la regla la dará por cumplida.

En paralelo, el fix debe **cerrar la deuda acumulada**: consolidar las 36 specs / 1054 tareas ya respaldadas por side-car, y triar manualmente las 3 specs / 18 tareas sin side-car (`20261024-120000-tienda-compra-y-cuentas` —7, `20270306-100000-tienda-compra-y-cuentas` —10, `20261113-120000-precio-promocional-en-pos-y-comprobantes` —1): o se hacen con evidencia, o se cierran con `[x]` + `Desvío:` + seguimiento trazado.

**Alternatives** (con su trade-off):

- **Hacer que el orquestador escriba directo en `tasks.md`**: elimina el paso de consolidación, pero el orquestador es externo (VPS1/Dokploy) y escribir el mismo archivo que edita el implementador reintroduce el conflicto de propiedad que el side-car evita hoy. Además, el repo no controla ese componente: el fix quedaría fuera de este worktree.
- **Script de una sola vez (one-shot) para vaciar el backlog y nada más**: es la más barata, pero no previene la reaparición — el bug volvería con la próxima épica. Solo válida si se acompaña del gate (2).
- **Derivar el estado de las tareas de los side-car en tiempo de lectura** (que `e2e-cobertura-epicas.py` y `cobertura-e2e.mjs` lean el side-car): arregla la evidencia sin tocar 41 archivos, pero deja el `tasks.md` mintiendo y duplica la lógica de resolución en dos consumidores. Bueno como mitigación, insuficiente como solución.

**Files likely to change**:

- `scripts/consolidar-marcas-tasks.mjs` (nuevo) y `scripts/consolidar-marcas-tasks.test.mjs` (nuevo)
- `package.json` — script `pnpm tareas:check` (y/o `tareas:consolidar`)
- `.github/workflows/validate.yml` — paso de gate
- `AGENTS.md`, `CLAUDE.md` — corregir la afirmación de la invariante
- `specs/*/tasks.md` — consolidación de las 36 specs respaldadas (y triaje de las 3 sin side-car)
- `scripts/e2e-cobertura-epicas.py`, `scripts/cobertura-e2e.mjs` — consumir el estado consolidado (o el side-car) sin divergir
- `.agents/skills/speckit-implement/SKILL.md`, `.claude/skills/speckit-implement/SKILL.md`, `.opencode/commands/speckit.implement.md` — la post-condición «Done When» debería exigir el estado verificable, no solo la intención

**Tests to add or update**:

- Unitario del consolidador: vuelca solo lo marcado en side-car; no toca `[x]`; preserva texto, evidencia y `Desvío:`; es idempotente (segunda corrida = 0 cambios); reporta las tareas sin respaldo.
- Unitario del gate: falla con una spec que tiene `[ ]` y side-car ya consolidado; pasa con `Desvío:` + seguimiento; pasa con specs de épicas no cerradas.
- Regresión de `scripts/cobertura-e2e.test.mjs` y del parser de `scripts/e2e-cobertura-epicas.py`: una historia con todas las tareas `[x]` (tras consolidar) se reporta como cubierta.
- Test del criterio de no-regresión del repo: `pnpm tareas:check` verde sobre el árbol tras la consolidación.

## Risks & Considerations

- **Falsificar la auditoría**: marcar `[x]` en `tasks.md` a partir del side-car presupone que el side-car es fidedigno. Si el runner marcó por error, la consolidación arrastra el error al archivo de verdad. Mitigación: consolidar solo lo que el side-car marca, registrar el origen (archivo + historia) para poder auditar el volcado.
- **Deuda real vs. ruido de formato**: de las 1099 abiertas, 1054 tienen respaldo en side-car y 18 no; 27 restantes corresponden a specs con side-car parcial. Marcar en bulk sin revisar puede cerrar tareas genuinamente pendientes. Mitigación: consolidar solo el subconjunto respaldado y triage explícito del resto, con `Desvío:` + seguimiento.
- **Conflicto con el orquestador**: el runner escribe side-cars y puede seguir escribiendo durante la consolidación. Mitigación: consolidador idempotente y ejecutable de nuevo; nunca escribir marcas nuevas desde este lado (solo volcar las existentes).
- **Diff masivo**: 36–41 `tasks.md` con cientos de líneas cambiadas → PR grande y difícil de revisar. Mitigación: commits por spec/épica, con la traza del side-car como justificación línea a línea.
- **Cumplimiento documental**: todo cambio de tooling propio debe actualizar `specs/` o `docs/` en el mismo cambio (`AGENTS.md`, «Documentación obligatoria») y pasar `pnpm docs:check`.
- **Sin riesgo de datos, API ni migraciones**: no hay cambios de esquema, RLS, endpoints ni migraciones; el radio de impacto es de proceso y de evidencia de release.
- **Riesgo de regresión en los consumidores E2E**: `e2e-cobertura-epicas.py` y `cobertura-e2e.mjs` deben seguir funcionando con `tasks.md` consolidado y con specs recién generadas (que aún no tienen side-car).

## Open Questions

- [NEEDS CLARIFICATION: el corte exacto «21 specs / 630 tareas» depende del estado «Finalizada» del tracker It's a Plan (proyecto `MSF`), que no es consultable sin `ITSAPLAN_API_KEY`. Localmente el alcance medido es mayor: 41 specs / 1099 tareas `[ ]`, de las cuales 1054 (36 specs) ya están marcadas `[x]` en side-cars.]
- [NEEDS CLARIFICATION: para las 3 specs sin side-car (`20261024-120000-tienda-compra-y-cuentas`, `20270306-100000-tienda-compra-y-cuentas`, `20261113-120000-precio-promocional-en-pos-y-comprobantes`, 18 tareas en total), ¿las tareas están hechas y solo sin tildar, o son deuda real que requiere `Desvío:` + seguimiento?]
- [NEEDS CLARIFICATION: ¿el runner externo puede escribir directo en `tasks.md`, o la propiedad exclusiva del `tasks.md` debe seguir siendo del implementador? La decisión determina si la consolidación vive en este repo (script + gate) o en el orquestador de VPS1.]
- [NEEDS CLARIFICATION: el gate debe distinguir «tarea abierta sin side-car» (deuda, bloquea) de «tarea abierta con side-car pero sin consolidar» (se consolida y pasa). Falta definir si el release bloquea o solo reporta.]
