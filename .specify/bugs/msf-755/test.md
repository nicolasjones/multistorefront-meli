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
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | **23 tests, 23 pass, 0 fail** (10 antes + 13 nuevos: capa de API con el payload real, fnmatch, protección clásica, veredicto sin `--pr`, guard del runbook y mapeo del código de salida de `gh`). |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | **78 tests, 77 pass, 1 skipped, 0 fail**. |
| Suite de docs | `pnpm test:docs:check` | pass | 171 tests, 171 pass, 0 fail (el flake de `recorrerSql` de la vuelta anterior no se repitió). |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Deriva de documentación | `node scripts/docs-drift.mjs` | pass | 18 páginas con deriva: **las 18 preexistentes de la base**. `docs/control-ci.md` salió de la lista (la deriva que había dejado el HEAD anterior). |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos. |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corre. |
| Estado real del gate | `node scripts/gate-integracion.mjs` | pass | Gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) + el aviso del 404 + veredicto, exit 0. |
| Estado real del gate con PR | `node scripts/gate-integracion.mjs --pr 1147` | pass | «La rama está al día con la base» + veredicto, exit 0. |
| El test vigila la regla (FEAT-236) | 8 mutaciones | pass | Falla la suite en las 8: `strict_required_status_checks_policy === false`; el detalle ilegible en silencio; el fnmatch reducido a nombre exacto; la protección clásica ignorada; el veredicto sin `--pr` eliminado; el runbook con la instrucción vieja; la salida 0 de `gh` como HTTP 0; y la protección clásica 200 sin cuerpo. Revertido, los 23 vuelven a verde. |

## Revalidación del HEAD `fdbf6741ef` (2026-11-21)

Se revalidó el HEAD real de la rama (`fdbf6741efcd2960967cda52951cb3ba7d30acf2`,
que es el que abrió el PR #1147) sin cambiar el código: el diff contra
`origin/dokploy` sigue siendo el de esta historia (script, tests, `package.json`,
runbooks y la bitácora del bug).

| Check | Result | Notes |
|-------|--------|-------|
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | **23 tests, 23 pass, 0 fail**. |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | **78 tests, 77 pass, 1 skipped, 0 fail**. |
| Suite de docs | `pnpm test:docs:check` | pass | **171 tests, 171 pass, 0 fail**. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Deriva de documentación | `node scripts/docs-drift.mjs` | pass | 18 páginas con deriva: **las 18 preexistentes de la base**. `docs/control-ci.md` no está en la lista. |
| Links y nav de la documentación | `node scripts/docs-check.mjs` | pass | nav 219 páginas, links internos 2004, inventario y diagramas OK. |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos (los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca). |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corrió y salió verde. |
| Estado real del gate | `node scripts/gate-integracion.mjs` | pass | Gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) + el aviso del 404 + veredicto, exit 0. |
| Estado real del gate con PR | `pnpm ci:gate -- --pr 1147` | pass | «La rama está al día con la base» + veredicto, exit 0. |
| Estado real del gate por la API | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575` | pass | `enforcement: active`, target `branch`, `include: [refs/heads/dokploy]`, `strict: false`, check `validacion`, bypass `RepositoryRole 5`/`always`: los datos que el informe y la documentación citan siguen siendo los del repo. |
| La trampa (API) | `gh api repos/nicolasjones/multistorefront-meli/branches/dokploy/protection` | pass | Sigue dando 404 «Branch not protected»: la trampa es real y el diagnóstico la neutraliza. |
| Cola de merge por API | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575/merge-queue` | pass | 404: GitHub no expone `merge_queue` para este repo ⇒ queda como acción de Nicolás (documentada, no ejecutada). |
| El test vigila la regla (FEAT-236) | 3 mutaciones | pass | Fallan 7, 1 y 2 tests respectivamente: `strict_required_status_checks_policy === false`; el detalle ilegible descartado en silencio; y la protección clásica ignorada. Revertido, los 23 vuelven a verde. |
| CI del PR | `gh run list --branch fix/bug-MSF-755` | pass | `Validate` y `quality` en **success** sobre el HEAD `fdbf6741ef`; PR #1147 `MERGEABLE`/`CLEAN`. |

## Cuarta vuelta (2026-11-21) — devolución de la revisión (SHA `84ca53fab8c`)

Se atendieron los seis hallazgos técnicos y el de seguridad de la
devolución (fnmatch de GitHub, `~DEFAULT_BRANCH` en `exclude`, test del `?`,
código de salida `2`, la acción de la cola de merge escrita en tres lugares, el
ejemplo de `DELETE`, y la validación de `--repo`/`--base`) y se reejecutó todo
lo verificable del repo.

| Check | Result | Notes |
|-------|--------|-------|
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | **34 tests, 34 pass, 0 fail** (23 antes + 11 nuevos: `[]` y su clase negada, `?`, `**` suelto, `**/` recursivo, patrón inválido, `~DEFAULT_BRANCH` en `exclude` y el rechazo de `--repo`/`--base` inválidos). |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | **89 tests, 88 pass, 1 skipped, 0 fail**. |
| Suite de docs | `pnpm test:docs:check` | pass | **171 tests, 171 pass, 0 fail**. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Deriva de documentación | `node scripts/docs-drift.mjs` | pass | 18 páginas con deriva: **las 18 preexistentes de la base**. `docs/control-ci.md` no está en la lista. |
| Links y nav de la documentación | `node scripts/docs-check.mjs` | pass | nav 219 páginas, links internos 2004, inventario y diagramas OK. |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos (los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca). |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corre. |
| Estado real del gate | `node scripts/gate-integracion.mjs` | pass | Gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) + el aviso del 404 + veredicto, exit 0. |
| Estado real del gate con PR | `node scripts/gate-integracion.mjs --pr 1147` | pass | «La rama está al día con la base» + veredicto, exit 0. |
| Argumentos inválidos | `node scripts/gate-integracion.mjs --repo 'owner/nombre/../otro'` · `--base 'main..otra'` | pass | exit 2 con el mensaje del argumento, **antes** de cualquier consulta a la API. |
| La trampa (API) | `gh api repos/nicolasjones/multistorefront-meli/branches/dokploy/protection` | pass | Sigue dando 404 «Branch not protected»: la trampa es real y el diagnóstico la neutraliza. |
| Cola de merge por API | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575/merge-queue` | pass | 404: GitHub no expone `merge_queue` para este repo ⇒ queda como acción de Nicolás (documentada en un solo lugar, no ejecutada). |
| El test vigila la regla (FEAT-236) | 8 mutaciones | pass | Falla la suite en las 8: `**/` sin recursión; `[]` como literal; `~DEFAULT_BRANCH` sólo desde `include`; el comodín `?` eliminado; `--repo`/`--base` sin validar; el patrón inválido ignorado en silencio; una clase que matchea la `/`; y `*` cruzando la `/`. Revertido, los 34 vuelven a verde. |

### La semántica del matcher, con la fuente

El `fnmatch` de GitHub no es una suposición: la documentación de la API de
rulesets dice que GitHub usa `File.fnmatch` de Ruby con el flag
`File::FNM_PATHNAME` y enlaza la doc de Ruby 2.5.1. De ahí sale que `*` no
cruza `/`, que `?` y las clases de caracteres tampoco matchean una `/`, que `**/`
es la forma recursiva (cero o más niveles de directorio) y que un `**` que no
va seguido de `/` equivale a `*`. Los tests fijan esas cuatro reglas. La misma
página advierte dos límites que el matcher respeta: `^` no complementa un juego
(sólo `!`) y `\` no es carácter de citación.

## Quinta vuelta (2026-11-21) — devolución de la revisión (SHA `6d18175e1d`)

Se atendieron los seis hallazgos técnicos y el de seguridad de la devolución (el
`^` literal, el `\` literal, los tests de esas ramas, el rechazo de `.`/`..`,
la numeración y el conteo de la bitácora, y la frase de `**`) y se reejecutó lo
verificable del repo.

| Check | Result | Notes |
|-------|--------|-------|
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | **36 tests, 36 pass, 0 fail** (34 antes + 2: el `^` literal dentro de `[]` y el `\` literal dentro/fuera de `[]`; además se ampliaron los de validación de `.`/`..`). |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | **91 tests, 90 pass, 1 skipped, 0 fail**. |
| Suite de docs | `pnpm test:docs:check` | pass | **171 tests, 171 pass, 0 fail**. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Deriva de documentación | `node scripts/docs-drift.mjs` | pass | 18 páginas con deriva: **las 18 preexistentes de la base**. `docs/control-ci.md` salió de la lista (el manifest se regeneró con `pnpm docs:manifest`). |
| Links y nav de la documentación | `node scripts/docs-check.mjs` | pass | nav 219 páginas, links internos 2004, inventario y diagramas OK. |
| Lint / Build | `pnpm lint` · `pnpm build` | pass | exit 0 en los dos (los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca). |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; **gitleaks no corrió** (sin permisos del socket de Docker en este entorno). El job `quality` del CI lo corre. |
| El test vigila la regla (FEAT-236) | 6 mutaciones | pass | Falla la suite en las 6: volver `^` a complemento (1 test); volver el escape de `\` dentro de `[]` (2); dejar de escapar la `\` fuera de `[]` (1); quitar el cierre implícito del juego terminado en `\` (1); y sacar el rechazo de `.`/`..` en `--repo` (2) y en `--base` (2). Revertido, los 36 vuelven a verde. |

### El escenario exacto del revisor, verificado

El revisor mostró el caso que produce el falso verde: con `include:
['refs/heads/[^charset]*']` (el ejemplo de la propia documentación de GitHub)
GitHub protege `refs/heads/abc` y el script la rechazaba. El estado real del
script antes y después del arreglo, sobre los patrones del hallazgo:

| Patrón | Rama | Antes (`6d18175e1d`) | Después |
|---|---|---|---|
| `refs/heads/[^charset]*` | `abc` | **no matchea** («no hay gate» falso) | matchea (como GitHub) |
| `refs/heads/[^0-9]*` | `abc` | matchea (GitHub no complementa con `^`) | no matchea (el `^` es un miembro más) |
| `refs/heads/x[\*]` | `x\` | **no matchea** | matchea (el `\` es miembro del juego) |
| `refs/heads/x[\*]` | `x*` | matchea | matchea |
| `refs/heads/x[\` | `x\` | **aborta (exit 2)** | matchea (no aborta) |
| `refs/heads/x\` | `x\` | matchea | matchea |
| `refs/heads/x[` | `x[` | **aborta (exit 2)** | **aborta (exit 2)**: un juego sin cerrar es un patrón que no se puede interpretar y falla en voz alta (comportamiento de la cuarta vuelta, que no se toca) |


## Residual Risks

- **El diagnóstico es una foto del ruleset**: entre la consulta y el merge el ruleset puede cambiar. El informe dice cómo volver a mirarlo (`pnpm ci:gate`), pero no lo bloquea.
- **La cola de merge sigue sin activarse**: es la configuración del ruleset y GitHub no la expone por API para este repo. Queda como acción de Nicolás (escala humana), documentada en `docs/control-ci.md`. Con «rama al día» desactivada (el estado actual) el merge no se rechaza por desfasaje, así que el ciclo no se reproduce; si alguien reactiva «rama al día» sin activar la cola de merge, el ciclo vuelve — por eso el script lo dice explícitamente en el veredicto `bloqueado`.
- **Los pasos de merge del flujo** (`merge-con-revisiones.sh`, `merge-seguro.sh`) no están versionados en este repo: no se pudo verificar si consultan el gate por el endpoint clásico. La cobertura de MSF-755 es el gate de GitHub y el runbook del repo.
- La cola del CI (~1 h en los runners self-hosted, la del síntoma original) no se midió en esta corrida: no es código del repo y no cambia con este arreglo.

## Recommendation

**Cerrar el bug — verificado en el repo.** El diagnóstico se hace por el endpoint correcto, la trampa del 404 queda documentada y el runbook no vuelve a mandar a resincronizar la rama. Queda una sola acción, que no es de código y es decisión de Nicolás: activar la «Merge queue» del ruleset `dokploy-integracion-protegida` (documentada con el camino exacto).
