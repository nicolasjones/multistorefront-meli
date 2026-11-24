# Bug Assessment: el gate de integración de `dokploy` se diagnostica por el endpoint equivocado

- **Slug**: msf-755
- **Created**: 2026-11-18
- **Source**: pasted text (tracker MSF-755, verificación del CTO del 2026-11-03 08:45 UTC, con MSF-700 / PR #642)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> El gate de integración de `dokploy` exige **rama al día** contra una base que avanza más rápido de lo que tarda el CI en turnar. Resultado: ningún PR de épica converge, y el ciclo `update-branch → CI (~1 h en cola) → BEHIND otra vez → update-branch` no termina.
>
> **Hecho 1 — la protección SÍ existe, pero no en el endpoint que se consultó.** `GET /repos/.../branches/dokploy/protection` → **404 "Branch not protected"**. Ese endpoint es el de *branch protection* clásico; este repo usa **rulesets**. El ruleset real es `GET /repos/nicolasjones/multistorefront-meli/rulesets/25358575` → `dokploy-integracion-protegida`, `enforcement: active`, target `refs/heads/dokploy`; regla `required_status_checks` con check único `validacion` y `strict_required_status_checks_policy: true` (= rama al día obligatoria); `bypass_actors`: `RepositoryRole id 5` (admin), `bypass_mode: always`.
> Consecuencia: una instrucción que se apoya en el 404 («no hay protección, se puede mergear aunque la rama no esté al día») es **incorrecta** y produce una ronda muerta: el merge es rechazado con *"head branch is not up to date"* y se vuelve a sincronizar la rama.
>
> **Hecho 2 — la base avanza más rápido que el CI.** `dokploy` avanzó 5 commits (PR #625 / MSF-601) entre las 06:59 y las 08:45 UTC; en paralelo el run del CI sobre el head del PR tardó más de 1 h 20 min en disponerse (jobs `application` y `web (3)` `QUEUED` desde las 07:24, run 41593334139, 4 runners self-hosted online y los 4 `busy`). Con base protegida, «al día» deja de cumplirse antes de que el CI termine ⇒ no converge.
>
> **Hecho 3 — el camino ya está soportado por el repo, pero la API lo rechaza.** `validate.yml` (en `dokploy` y en el head del PR) ya tiene el trigger `merge_group` y el job `validacion` con la agregación de resultados: está escrito para la cola de merge; lo que falta es activarla en el ruleset, y la API de GitHub no la expone para este repo.

## Symptom

El diagnóstico del gate de integración de `dokploy` se hace sobre el endpoint equivocado (`/branches/<rama>/protection`, que devuelve 404 «Branch not protected» porque el repo protege con **rulesets**), así que se concluye que la rama no está protegida y se responde al «head branch is not up to date» resincronizando la rama; como la base avanza más rápido que el CI, ese resync reinicia el CI y el ciclo no termina. Lo que se esperaba: un diagnóstico que lea el gate real (ruleset `dokploy-integracion-protegida`) y diga si «rama al día» está o no exigida, y qué hacer según eso.

## Reproduction

1. Consultar el gate con el endpoint de protección clásica: `gh api repos/nicolasjones/multistorefront-meli/branches/dokploy/protection` → **404** `Branch not protected`.
2. Consultar el gate real: `gh api repos/nicolasjones/multistorefront-meli/rulesets` → el ruleset `dokploy-integracion-protegida` (id `25358575`), `enforcement: active`, target `refs/heads/dokploy`.
3. Leer su regla `required_status_checks`: check único `validacion` + `strict_required_status_checks_policy` («rama al día») + `bypass_actors` (`RepositoryRole 5`, `bypass_mode: always`).
4. Con la rama del PR detrás de `dokploy` y «rama al día» exigida, `gh pr merge` responde *«head branch is not up to date»*.
5. Resincronizar la rama reinicia el CI (~1 h en cola de runners self-hosted); mientras tanto la base avanzó otra vez (5 commits en 1 h 46 min el 2026-11-03) ⇒ el paso 4 se repite indefinidamente.

## Suspected Code Paths

- `docs/control-ci.md:316-343` — sección «Integración protegida de `dokploy`»: describe el ruleset pero **no** advierte que `/branches/<rama>/protection` devuelve 404 y miente, y su «Consecuencia operativa» (líneas 341-343) manda a **actualizar la rama y reintentar** ante un «head branch is not up to date»: es exactamente la instrucción que produce el ciclo, y contradice el estado real del ruleset (rama al día desactivada desde el 2026-11-04, línea 324).
- `docs/control-ci.md:492-494` — «Cola de merge»: dice que el workflow ya reacciona a `merge_group` pero el ruleset no tiene la regla; deja la decisión sin indicar que es de Nicolás (escala humana).
- `scripts/` — no existe ninguna herramienta del repo que lea el gate real: nada obliga a consultar la API de rulesets, así que el diagnóstico queda en manos de quien lo haga a mano (y por el endpoint equivocado).
- `.github/workflows/validate.yml:12` y `:497` — el trigger `merge_group` y la suite completa en `merge_group` ya están escritos (Hecho 3): no hay que tocar el workflow.

## Root Cause Hypothesis

El gate de `dokploy` no es «branch protection» sino un **ruleset**, y los dos se consultan por endpoints distintos: `GET /repos/{repo}/branches/{rama}/protection` (clásico) devuelve 404 aunque haya un ruleset activo, mientras que el estado real vive en `GET /repos/{repo}/rulesets`. El repo no tiene ninguna fuente única que exponga ese estado, así que el diagnóstico se hace a mano y puede apoyarse en el 404, que induce la conclusión «no hay protección ⇒ se puede mergear aunque la rama no esté al día». El runbook de `docs/control-ci.md` refuerza el error: en la misma página afirma que «rama al día» está desactivada (línea 324) y, a la vez, que ante un «head branch is not up to date» hay que actualizar la rama y reintentar (líneas 341-343). Confianza: **alta** — el estado real del ruleset se verificó por API el 2026-11-18 (`strict_required_status_checks_policy: false`, `enforcement: active`, check único `validacion`, `bypass_actors` `RepositoryRole 5`/`always`), y el 404 de `/branches/dokploy/protection` se reprodujo.

## Proposed Remediation

**Preferred**: dar al repo una **fuente única y correcta** del estado del gate de integración, que se lea por la API de rulesets y no por el endpoint de protección clásica, y que neutralice explícitamente la trampa del 404. Concretamente:

1. `scripts/gate-integracion.mjs`: script de sólo lectura que consulta `GET /repos/{repo}/rulesets` (+ el detalle de cada ruleset) y arma el gate efectivo de la rama base (`dokploy`): enforcement, check(s) requerido(s), si exige «rama al día» (`strict_required_status_checks_policy`), bypass actors y si hay regla de cola de merge. Además consulta `/branches/<rama>/protection` **sólo para detectar la trampa**: si devuelve 404 y hay un ruleset activo, el informe dice explícitamente que ese 404 no significa «sin protección». Si se le pasa un PR, compara la rama contra la base (`behind_by`) y devuelve el veredicto:
   - «rama al día» **no** exigida ⇒ el merge no se rechaza por desfasaje: no hay que resincronizar la rama;
   - «rama al día» exigida **y** rama atrás ⇒ el merge va a fallar con «head branch is not up to date» y el ciclo no termina mientras la base avance más rápido que el CI.
   La lógica de decisión queda en funciones puras (testeables sin red) y la lectura de la API en una capa aparte.
2. `scripts/gate-integracion.test.mjs`: tests que fijan la decisión (con «rama al día» exigida el veredicto es «bloqueado»; sin ella no) y la trampa del 404 (un ruleset activo + 404 en el endpoint clásico ⇒ el informe NO dice que no hay protección).
3. `docs/control-ci.md`: corregir la «Consecuencia operativa» que manda a resincronizar la rama (es la que genera el ciclo) y documentar la trampa del 404, el endpoint correcto y el script. La activación de la **cola de merge** queda explícitamente como acción de Nicolás (escala humana), con el comando y el motivo.

**Alternatives** (opcional):
- Sólo corregir el texto de `docs/control-ci.md`: más chico, pero el diagnóstico correcto queda igual a mano y el 404 sigue siendo la respuesta más obvia de la API; la trampa vuelve en cuanto alguien consulta el endpoint clásico.
- Cambiar el ruleset desde el repo (PATCH a `strict_required_status_checks_policy`): no corresponde — el estado ya está en `false` y la configuración de GitHub es acción de Nicolás.

**Files likely to change**:
- `scripts/gate-integracion.mjs` (nuevo)
- `scripts/gate-integracion.test.mjs` (nuevo)
- `package.json` (script `ci:gate` + suite de tests)
- `docs/control-ci.md` (runbook)

**Tests to add or update**:
- Test de la decisión: ruleset activo con `strict_required_status_checks_policy: true` y rama atrás ⇒ veredicto «bloqueado» que menciona «head branch is not up to date» y la salida (desactivar «rama al día» o activar la cola de merge).
- Test de la decisión: el mismo ruleset con `strict: false` ⇒ veredicto «no bloqueado» y el informe NO pide resincronizar la rama.
- Test de la trampa: `/branches/<rama>/protection` en 404 + ruleset activo ⇒ el informe dice que el gate existe (no dice «sin protección») y menciona el ruleset por id y nombre.
- Test de la trampa inversa: 404 y ningún ruleset ⇒ ahí sí se dice que no hay gate.
- Guard de documentación: `docs/control-ci.md` tiene que seguir nombrando el endpoint de rulesets y la trampa del 404, y no volver a la instrucción de resincronizar la rama.

## Risks & Considerations

- El script habla con la API de GitHub: necesita `gh` autenticado y token con permiso de lectura del repo. Sin red debe fallar con un mensaje claro, no con un falso «no hay gate» (un falso verde en el diagnóstico es peor que no tener diagnóstico).
- Es de sólo lectura: no modifica el ruleset ni hace merge. La configuración de la protección y la cola de merge siguen siendo de Nicolás.
- El estado del ruleset puede cambiar entre la consulta y el merge: el informe es una foto, no una garantía; por eso la salida dice cómo volver a mirarlo.
- Sin migraciones ni cambios de BD: no aplica versión de migración.
- El veredicto «bloqueado» debe ser inequívoco: si el gate no exige «rama al día», un PR atrasado igual puede mergear (con `validacion` en verde) y eso hay que decirlo, porque la instrucción contraria genera el ciclo.

## Open Questions

- [NEEDS CLARIFICATION: la descripción del tracker termina cortada en «está escrito para» (Hecho 3). Se asume que se refiere a la cola de merge (`merge_group`), que es lo que el repo ya soporta y lo que GitHub no expone por API para este repo.]
- [NEEDS CLARIFICATION: qué pasos del merge (`merge-con-revisiones.sh`, `merge-seguro.sh`) quedan fuera del repo. No están versionados acá, así que el arreglo de MSF-755 se limita al gate de GitHub y al runbook.]
