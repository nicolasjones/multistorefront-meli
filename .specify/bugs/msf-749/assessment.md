# Bug Assessment: el guard de migraciones compara el árbol entero contra la punta de `origin/dokploy` y hereda los errores de una base que avanzó

- **Slug**: msf-749 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text (Jira MSF-749)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim)

> [seguimiento] El guard de migraciones compara el árbol entero contra `origin/dokploy`: 13 PRs abiertos quedan `BEHIND` y su job `application` falla aunque no toquen migraciones (It's a Plan MSF-749)

Contexto heredado del BRAIN (no verificado contra el código, se usa sólo como antecedente):
el mismo patrón y su salida ya están documentados en **MSF-749** (deuda técnica, hijo de MSF-515);
`data/aprendizaje-flujo/MSF.jsonl`: «una rama abierta que no se actualiza con la base hereda fallos del
guard de migraciones que no son suyos → la base renumeró 40 migraciones y 13 PRs abiertos quedaron atrás con
`application` rojo → decisión: el Developedor mergea la base; el flujo debería hacerlo solo antes de correr
`Validate`».

## Symptom

Cuando la rama de destino (`dokploy`) renumera migraciones, toda rama abierta que quedó atrás (`BEHIND`) falla
el paso `pnpm docs:check` del job `application` con errores `versión … REUSADA` / `versión … MODIFICADA` que
**no son de ese PR**: el guard compara el árbol de migraciones *completo* de la rama contra la *punta* de
`origin/dokploy`, así que las migraciones que el PR heredó (y que la base renumeró o renombró) se leen como
«migraciones nuevas o modificadas del PR». El check requerido `validacion` queda rojo y el PR no puede
mergear, aunque el PR no toque `supabase/migrations/` en absoluto.

## Reproduction

Reproducido localmente contra el estado real del repo (sin tocar el código; worktree temporal en `/tmp`,
ya eliminado):

1. La base `origin/dokploy` (`1ad0fd2e`) tiene 671 migraciones y su versión máxima es `20270322100700`;
   el commit `46e78928` (*«chore(MSF-848): renumerar la migración de estilo del héroe a 20270311100000»*)
   renombró `20270308100000_tienda_estilo_heroe_mayusculas.sql` → `20270311100000_…` (es el patrón
   crónico: `df2dee39` renumeró 65 migraciones de un tirón, `01c1901e` 4, `e14a727e` 6, etc.).
2. Se crea un worktree en el commit padre de ese renumerado (`46e78928^`), que representa una rama abierta
   que quedó atrás:
   `git worktree add --detach /tmp/opencode/sim-behind 46e78928^`
3. Se corre el guard **de HEAD** (el de esta rama, sin cambios) con el árbol de ese worktree y la base real:
   `cd /tmp/opencode/sim-behind && GITHUB_BASE_REF=dokploy node /worktrees/bug-MSF-749/scripts/verificar-migraciones.mjs`
4. Salida (exit code **1**):
   ```
   Migraciones: revisar antes de mergear
    - versión 20270308100000 REUSADA: ya existe 20270322100700 o mayor en origin/dokploy; usá una versión nueva y mayor (supabase/migrations/20270308100000_tienda_estilo_heroe_mayusculas.sql)
   ```
   Ese archivo **no lo agregó el PR**: lo heredó de la base antes del renumerado. El PR queda rojo igual.
5. Con una rama más atrás (`6421b9cd^`, anterior al renumerado de MSF-825) el mismo comando acumula además
   `MODIFICADA` (`20270228100000` existe en la base con *otro* archivo, porque MSF-825 renumeró la de la
   tienda y la de la API Tomó ese número) → 6 errores falsos y exit 1.

En el CI esto es el paso `pnpm docs:check` (que encadena el guard) del job `application`; `validacion`
—el check único requerido por el ruleset de `dokploy`— falla porque `application` falló.

[NEEDS CLARIFICATION: la cuenta exacta de «13 PRs» y qué commit base tenía cada uno no se pudo verificar
(no hay red/`gh` en este worktree); lo verificado es el mecanismo y su reproducción, no la lista de PRs.]

## Suspected Code Paths

- `scripts/verificar-migraciones.mjs:34` — resuelve la base de comparación: `origin/${GITHUB_BASE_REF}` en un
  PR (`dokploy`) o `origin/dokploy` por defecto. Es la **punta** de la base, no el punto de divergencia.
- `scripts/verificar-migraciones.mjs:38` — `ordenEstricto = … || Boolean(process.env.GITHUB_BASE_REF)`: en un PR
  el desvio de orden pasa de aviso a **error**, con lo que un `REUSADA` heredado tumba el job.
- `scripts/verificar-migraciones.mjs:45-46` — el alcance es **todo** el árbol de la rama: `git ls-files supabase/migrations`
  (sin filtrar por lo que el PR agrega).
- `scripts/verificar-migraciones.mjs:52-56` — el nombre inválido se evalúa sobre el árbol completo (un nombre malo
  heredado de la base también culpa al PR).
- `scripts/verificar-migraciones.mjs:75-93` — `REUSADA`: si la versión del archivo de la rama no existe en la punta
  de la base y es `<= maxBase` → error. La renumeración de la base deja las versiones viejas «desconocidas» ⇒ error falso.
- `scripts/verificar-migraciones.mjs:94-111` — `MODIFICADA`: compara el contenido de la rama contra el de la base
  **por número de versión**; si la base renumeró y reutilizó ese número para otra migración, el error es falso.
- `scripts/verificar-migraciones.mjs:117-126` — el conjunto `nuevos` (los que se revisan de idempotencia) es
  «archivos cuya versión no existe en la base» ⇒ las migraciones renumeradas por la base vuelven a entrar como
  «nuevas» del PR y se les exige idempotencia que ya se validó cuando se publicaron.
- `package.json:95` — `docs:check` = `verificar-documentacion-cambios.mjs && verificar-migraciones.mjs`: así entra
  el guard al CI.
- `.github/workflows/validate.yml:130` — paso `pnpm docs:check` del job `application` (`:114-118`): ahí muere el PR.
- `.github/workflows/validate.yml:667-707` — job `validacion`, check único requerido: agrega el resultado de
  `application` y falla ⇒ el PR no puede mergear.
- Precedente del scoping correcto (el guard es el único que compara contra la punta):
  `.github/workflows/validate.yml:74` (`git diff --name-only "$BASE...HEAD"` — tres puntos = merge-base) y
  `.github/workflows/validate.yml:390` (`git merge-base "origin/${{ github.base_ref }}" HEAD` para `vitest --changed`),
  `scripts/verificar-documentacion-cambios.mjs:11-14` (merge-base con `origin/main`).
- `scripts/verificar-migraciones.test.mjs` — tests actuales: cubren aviso/error de `REUSADA`, `MODIFICADA`,
  duplicados, nombre inválido y renombre de archivo sin nombre, pero **ninguno** cubre una rama que quedó atrás
  (no hay fixture con la base renumerando migraciones).
- `docs/guard-migraciones.md` — documenta el guard («respeto de `origin/dokploy`») y hay que actualizarlo junto al fix.

## Root Cause Hypothesis

El guard responde la pregunta equivocada. Quiere saber *«qué migraciones agrega este PR y chocan con lo que ya
existe?»*, pero la formula como *«compara todos los archivos de migraciones de mi rama contra el árbol de la
punta de la base»*. Cuando la base avanza (y en este repo avanza **renumerando migraciones**, casi todos los
días: `df2dee39` 65, `e73fed28` 65, `e14a727e` 6, `4fd3283a` 6, `01c1901e` 4, `6421b9cd` 3, `45fb9467` 3…), la
rama que quedó atrás conserva los nombres/versiones viejos, y desde la punta de la base esos archivos
«no existen» ⇒ el guard los trata como migraciones nuevas del PR (`REUSADA`, por debajo del máximo de la base) o
como versiones mutadas (`MODIFICADA`, si el número de versión pasó a otro archivo). En un PR, `ordenEstricto`
convierte eso en error y `application` → `validacion` quedan rojos. El defecto es **de alcance**, no de regla:
falta el punto de divergencia (`git merge-base origin/dokploy HEAD`) que ya usan el job `changes`, el job `web` y
`verificar-documentacion-cambios.mjs`. Confianza: **alta** (reproducido).

Efecto secundario del mismo defecto: el conjunto `nuevos` de la revisión de idempotencia incluye las
migraciones renumeradas por la base, así que el PR también hereda errores de idempotencia de migraciones
históricas que ya se publicaron.

## Proposed Remediation

**Preferred**: que el guard defina su alcance con el **merge-base** y no con la punta de la base.

1. Resolver dos referencias: `FORK = git merge-base <base> HEAD` (punto de divergencia) y `PUNTA = <base>`
   (la punta, para detectar colisiones reales contra lo que ya existe).
2. Definir *migraciones propias del PR* = las que el PR **agrega o modifica** respecto de `FORK`
   (`git diff --name-only FORK...HEAD -- supabase/migrations`, más el filtro de «contenido distinto»).
   Todo lo que el PR heredó sin tocar queda **fuera** del alcance.
3. Aplicar las reglas (`REUSADA`, `MODIFICADA`, nombre inválido, idempotencia) **sólo** a las migraciones
   propias, comparándolas contra `PUNTA` (no contra `FORK`): así el PR sigue teniendo que usar una versión
   libre y mayor que la de la base, y no se pierde teeth.
4. Cuando el PR herede una migración que la base renumeró/renombró (o viceversa), **avisar** (no fallar) con
   una instrucción accionable: «la base renumeró la versión X: actualizá tu rama (merge de la base) antes de
   mergear». El aviso cubre también el caso de migración duplicada al integrar (la base tiene `X_nuevo.sql` y
   la rama `X_viejo.sql`).
5. Mantener la semántica de `--solo-idempotencia`, `--estricto` y los códigos de salida; y agregar fallback
   cuando `merge-base` no resuelve (clone superficial): `verificar-documentacion-cambios.mjs:15` ya tiene el
   patrón (`FORK` → `HEAD~1` → la referencia itself).

El resultado: un PR que no toca migraciones pasa aunque la base haya renumerado; un PR que **sí** agrega una
migración con versión reusada o no idempotente sigue falling como hoy.

**Alternatives** (con su trade-off):
- *Cambiar sólo la referencia de comparación a `FORK` (una línea):* arregla los falsos positivos de REUSADA /
  MODIFICADA / idempotencia y es el diff más chico, pero pierde la detección de colisiones introducidas por la
  base **después** del fork (la migración del PR podría pisar una versión que la base ya aplicó) — de ahí que
  la opción preferida.compare contra `PUNTA` para las colisiones.
- *Resolverlo en el flujo (complemento, no sustituto):* que el flujo mergee la base en la rama antes de correr
  `Validate` (la decisión ya anotada en `data/aprendizaje-flujo/MSF.jsonl` para MSF-749). Sirve para el
  conflicto de merge real (migración duplicada al integrar) que el guard no puede resolver, pero no evita el
  rojo falso mientras el PR siga atrás: el guard tiene que dejar de fallar por culpa de la base.

**Files likely to change**:
- `scripts/verificar-migraciones.mjs` (alcance por merge-base + comparación de colisiones contra la punta + aviso de base renumerada)
- `scripts/verificar-migraciones.test.mjs` (tests nuevos del alcance)
- `docs/guard-migraciones.md` (qué se revisa y qué no, y qué hacer cuando la base renumera)
- `docs/control-ci.md` (nota operativa: qué hacer con un PR `BEHIND` — merge de la base antes de `Validate`)
- `.specify/bugs/msf-749/fix.md` y `.specify/bugs/msf-749/test.md` (artefactos del fix)

**Tests to add or update** (`scripts/verificar-migraciones.test.mjs`, con un repo git temporal como el que ya
usa `conRepo`, pero con **dos commits** —base y rama— y un `refs/remotes/origin/dokploy` que apunte a la punta):
- Rama que quedó atrás (la base renumeró una migración) **sin tocar migraciones** → exit 0 (hoy falla con `REUSADA`).
- Rama que quedó atrás y **agrega** su propia migración con versión `<= maxBase` → exit 1 con `REUSADA` (el guard no pierde teeth).
- Rama que **modifica** una migración publicada → exit 1 con `MODIFICADA`.
- Migración heredada de la base, sin `IF NOT EXISTS` → no se revisa de idempotencia (no es nueva del PR).
- Versión duplicada dentro de la rama → exit 1 (se mantiene).
- Nombre inválido en un archivo **agregado por el PR** → exit 1; nombre inválido **heredado** → no culpa al PR.
- Clone superficial / `merge-base` irresoluble → fallback a `HEAD~1` sin romper la ejecución.

## Risks & Considerations

- **El guard se debilita a propósito**: con el alcance por merge-base, un PR ya no falla por lo que la base hizo
  después del fork. Mitigación: las colisiones se siguen comparando contra la punta (`PUNTA`), y el PR recibe un
  **aviso** explícito de que su rama quedó atrás.
- **Colisión real al integrar**: al mergear una rama atrás, la base tiene `X_nuevo.sql` y la rama `X_viejo.sql` ⇒
  la misma migración puede aplicarse dos veces. Eso no lo arregla el guard: hay que resolverlo en el merge
  (complemento flujo: mergear la base en la rama antes de `Validate`).
- **Los avisos se acumulan**: en un PR muy atrasado el aviso «la base renumeró N migraciones» puede listar
  decenas de líneas; conviene resumirlo (conteo + las N primeras) para no ahogar el log.
- **Cuidado con el push**: en un `push` a `dokploy`, `origin/dokploy` es la propia `HEAD`, así que hoy el guard
  ya no revisa versiones ni idempotencia (sólo duplicados y nombres). Con el alcance por merge-base sigue siendo
  así (merge-base = HEAD): no empeora, pero la cobertura del push sigue siendo baja — [NEEDS CLARIFICATION: si
  el push debería revisar contra la punta *anterior* del push].
- **Clones superficiales**: `git merge-base` puede fallar; hace falta fallback (patrón ya usado en
  `scripts/verificar-documentacion-cambios.mjs:15`). El job `application` hace checkout con `fetch-depth: 0`,
  pero las corridas locales y otros jobs pueden no tenerlo.
- **No romper la API del script**: `pnpm docs:check`, `--solo-idempotencia`, `--estricto` y los códigos de salida
  los usan `validate.yml`, los runbooks de `docs/` y los specs.
- **Documentación obligatoria**: el cambio es de tooling de CI ⇒ el mismo PR debe actualizar `docs/` y/o `specs/`
  (la constitución, `.specify/memory/constitution.md:165-168`) o `pnpm docs:check` va a fallar.
- **Orden de versiones**: seguir comparando el piso de versión contra la punta puede seguir generando el
  «renumerar en bucle» que el propio script tries to evitar (`scripts/verificar-migraciones.mjs:9-14`); es un
  problema conocido y **fuera del alcance** de este fix.

## Open Questions

- [NEEDS CLARIFICATION: los 13 PRs concretos, sus ramas base y el error exacto que muestran (¿`REUSADA`, `MODIFICADA`
  o ambos?) — no hay acceso a `gh` desde este worktree.]
- [NEEDS CLARIFICATION: ¿el aviso de «la base renumeró» debe ser bloqueante en algún evento (push a `dokploy`,
  `merge_group`) o siempre informativo?]
- [NEEDS CLARIFICATION: ¿el fix se acompaña del cambio de flujo (mergear la base en la rama antes de `Validate`)
  en el mismo PR o se sigue como tarea aparte del seguimiento MSF-749?]
- [NEEDS CLARIFICATION: ¿el guard debe seguir revisando el árbol completo cuando la base es la **epic** (rama de
  épica) o también pasar a merge-base? La regla actual (`ordenEstricto` por base de épica) sugiere que ahí sí
  interesa ver el orden global.]
