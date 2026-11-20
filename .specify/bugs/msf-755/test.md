# Bug Verification: el gate de integración de `dokploy` se diagnostica por el endpoint equivocado

- **Slug**: msf-755
- **Tested**: 2026-11-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma original —diagnosticar el gate por `/branches/<rama>/protection` (404
«Branch not protected») y concluir que la rama se puede mergear aunque esté
atrás, con el ciclo `not up to date → resincronizar → CI → BEHIND`— ya no se
puede reproducir: el repo tiene ahora una fuente única del gate que lee la API
de rulesets, avisa de la trampa del 404 y da el veredicto correcto, y los
runbooks ya no mandan a resincronizar la rama. En la tercera vuelta (2026-11-20,
tras la devolución de la revisión) el diagnóstico se hizo además **a prueba de
falsos verdes**: lee las dos capas del gate (rulesets y protección clásica),
interpreta los `include`/`exclude` como patrones fnmatch, falla en voz alta si
alguna lectura falla y da veredicto aunque no se le pase un PR. No se
encontraron regresiones.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `node scripts/gate-integracion.mjs` | pass | Muestra el gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) **y** la advertencia del 404: el endpoint clásico no ve los rulesets. |
| Reproducción (post-fix) | `node scripts/gate-integracion.mjs --pr 1146` | pass | Compara la rama del PR con la base y da el veredicto («La rama está al día con la base» / «el merge NO se rechaza por desfasaje»), exit 0. |
| Estado real del gate (API) | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575` | pass | `enforcement: active`, target `refs/heads/dokploy`, check único `validacion`, `strict_required_status_checks_policy: false`, `bypass_actors` `RepositoryRole 5` (`bypass_mode: always`). |
| La trampa (API) | `gh api repos/nicolasjones/multistorefront-meli/branches/dokploy/protection` | pass | Sigue dando 404 «Branch not protected»: el 404 es real y el que ahora está documentado y neutralizado, no la fuente de la verdad. |
| Cola de merge por API | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575/merge-queue` | pass | 404: GitHub no expone `merge_queue` para este repo ⇒ queda como acción de Nicolás (documentada, no ejecutada). |
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | 10 tests, 10 pass, 0 fail. |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | 65 tests, 64 pass, 1 skipped, 0 fail (incluye la suite nueva). |
| Suite de docs | `pnpm test:docs:check` | pass | 171 tests, 171 pass, 0 fail. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Links y nav de la documentación | `node scripts/docs-check.mjs` | pass | nav 219 páginas, links internos 2003, inventario y diagramas OK. |
| Lint | `pnpm lint` | pass | exit 0. Los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca. |
| Build | `pnpm build` | pass | `✓ built in 5.96s`, exit 0. |
| El test vigila la regla (FEAT-236) | se cambió `strict_required_status_checks_policy === true` por `=== false` | pass | Fallaron 4 tests (decisión y trampa); se revirtió y los 10 volvieron a verde. |

## Output Excerpts

```
$ node scripts/gate-integracion.mjs
Gate de integración de «dokploy»
  Regla: dokploy-integracion-protegida (ruleset 25358575, enforcement: active)
  Checks requeridos: validacion
  Rama al día: NO exigida (strict_required_status_checks_policy: false)
  Cola de merge: no (sin regla merge_queue)
  Bypass: RepositoryRole 5 (bypass_mode: always)
  Aviso: /branches/dokploy/protection devuelve 404 ("Branch not protected"): ese endpoint es la protección clásica y NO ve los rulesets.
  El gate real es el ruleset «dokploy-integracion-protegida» (id 25358575): no concluyas que se puede mergear sin su check requerido.
```

```
$ node --test scripts/gate-integracion.test.mjs
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

```
$ pnpm test:ci
ℹ tests 65
ℹ pass 64
ℹ fail 0
ℹ skipped 1
```

## Segunda vuelta (2026-11-19)

Se revalidó el arreglo sobre el HEAD real (`320706c01`), sin cambiar el código (sólo se
corrigió la cifra de tests de esta bitácora: la suite tiene 10 `it`, no 11).

| Check | Result | Notes |
|-------|--------|-------|
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | 10 tests, 10 pass, 0 fail. |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | 65 tests, 64 pass, 1 skipped, 0 fail. |
| Suite de docs | `pnpm test:docs:check` | pass | 171 tests: 170 pass + 1 **flake de línea base** (`recorrerSql rendimiento: miles de etiquetas $tN$…`, umbral de 500 ms). `scripts/verificar-trampas-conocidas.test.mjs` es **idéntico a `origin/dokploy`** (`git diff origin/dokploy` vacío) y al correrlo solo pasa. No lo causa este cambio. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corrió y salió verde. |
| Estado real del gate | `node scripts/gate-integracion.mjs --pr 1147` | pass | «La rama está al día con la base» + veredicto, exit 0. |
| El test vigila la regla (FEAT-236) | `strict_required_status_checks_policy === false` en el script | pass | Fallan **4** tests; revertido, los 10 vuelven a verde. |

## Tercera vuelta (2026-11-20) — devolución de la revisión

Se validó el HEAD `570f0ed2bc0b` con los cambios de la devolución y se
reejecutó todo lo verificable del repo.

| Check | Result | Notes |
|-------|--------|-------|
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | **19 tests, 19 pass, 0 fail** (10 antes + 9 nuevos: capa de API con el payload real, fnmatch, protección clásica, veredicto sin `--pr`, guard del runbook). |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | **74 tests, 73 pass, 1 skipped, 0 fail**. |
| Suite de docs | `pnpm test:docs:check` | pass | 171 tests, 171 pass, 0 fail (el flake de `recorrerSql` de la vuelta anterior no se repitió). |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Deriva de documentación | `node scripts/docs-drift.mjs` | pass | 18 páginas con deriva: **las 18 preexistentes de la base**. `docs/control-ci.md` salió de la lista (la deriva que había dejado el HEAD anterior). |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corre. |
| Estado real del gate | `node scripts/gate-integracion.mjs` | pass | Gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) + el aviso del 404 + veredicto, exit 0. |
| Estado real del gate con PR | `node scripts/gate-integracion.mjs --pr 1147` | pass | «La rama está al día con la base» + veredicto, exit 0. |
| El test vigila la regla (FEAT-236) | 6 mutaciones | pass | Falla la suite en las 6: `strict_required_status_checks_policy === false`; el detalle ilegible en silencio; el fnmatch reducido a nombre exacto; la protección clásica ignorada; el veredicto sin `--pr` eliminado; y el runbook con la instrucción vieja. Revertido, los 19 vuelven a verde. |

## Residual Risks

- **El diagnóstico es una foto del ruleset**: entre la consulta y el merge el ruleset puede cambiar. El informe dice cómo volver a mirarlo (`pnpm ci:gate`), pero no lo bloquea.
- **La cola de merge sigue sin activarse**: es la configuración del ruleset y GitHub no la expone por API para este repo. Queda como acción de Nicolás (escala humana), documentada en `docs/control-ci.md`. Con «rama al día» desactivada (el estado actual) el merge no se rechaza por desfasaje, así que el ciclo no se reproduce; si alguien reactiva «rama al día» sin activar la cola de merge, el ciclo vuelve — por eso el script lo dice explícitamente en el veredicto `bloqueado`.
- **Los pasos de merge del flujo** (`merge-con-revisiones.sh`, `merge-seguro.sh`) no están versionados en este repo: no se pudo verificar si consultan el gate por el endpoint clásico. La cobertura de MSF-755 es el gate de GitHub y el runbook del repo.
- La cola del CI (~1 h en los runners self-hosted, la del síntoma original) no se midió en esta corrida: no es código del repo y no cambia con este arreglo.

## Recommendation

**Cerrar el bug — verificado en el repo.** El diagnóstico se hace por el endpoint correcto, la trampa del 404 queda documentada y el runbook no vuelve a mandar a resincronizar la rama. Queda una sola acción, que no es de código y es decisión de Nicolás: activar la «Merge queue» del ruleset `dokploy-integracion-protegida` (documentada con el camino exacto).
