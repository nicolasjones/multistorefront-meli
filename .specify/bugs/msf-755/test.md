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
de rulesets, avisa de la trampa del 404 y da el veredicto correcto, y el runbook
ya no manda a resincronizar la rama. No se encontraron regresiones.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `node scripts/gate-integracion.mjs` | pass | Muestra el gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida, cola de merge no, bypass admin) **y** la advertencia del 404: el endpoint clásico no ve los rulesets. |
| Reproducción (post-fix) | `node scripts/gate-integracion.mjs --pr 1146` | pass | Compara la rama del PR con la base y da el veredicto («La rama está al día con la base» / «el merge NO se rechaza por desfasaje»), exit 0. |
| Estado real del gate (API) | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575` | pass | `enforcement: active`, target `refs/heads/dokploy`, check único `validacion`, `strict_required_status_checks_policy: false`, `bypass_actors` `RepositoryRole 5` (`bypass_mode: always`). |
| La trampa (API) | `gh api repos/nicolasjones/multistorefront-meli/branches/dokploy/protection` | pass | Sigue dando 404 «Branch not protected»: el 404 es real y el que ahora está documentado y neutralizado, no la fuente de la verdad. |
| Cola de merge por API | `gh api repos/nicolasjones/multistorefront-meli/rulesets/25358575/merge-queue` | pass | 404: GitHub no expone `merge_queue` para este repo ⇒ queda como acción de Nicolás (documentada, no ejecutada). |
| New / updated tests | `node --test scripts/gate-integracion.test.mjs` | pass | 11 tests, 11 pass, 0 fail. |
| Suite de CI (área tocada) | `pnpm test:ci` | pass | 65 tests, 64 pass, 1 skipped, 0 fail (incluye la suite nueva). |
| Suite de docs | `pnpm test:docs:check` | pass | 171 tests, 171 pass, 0 fail. |
| Guardas de documentación | `pnpm docs:check` | pass | Documentación de cambios OK · Migraciones OK (771 archivos, 0 nuevos contra `origin/dokploy`) · Trampas conocidas OK. |
| Links y nav de la documentación | `node scripts/docs-check.mjs` | pass | nav 219 páginas, links internos 2003, inventario y diagramas OK. |
| Lint | `pnpm lint` | pass | exit 0. Los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca. |
| Build | `pnpm build` | pass | `✓ built in 5.96s`, exit 0. |
| El test vigila la regla (FEAT-236) | se cambió `strict_required_status_checks_policy === true` por `=== false` | pass | Fallaron 4 tests (decisión y trampa); se revirtió y los 11 volvieron a verde. |

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
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

```
$ pnpm test:ci
ℹ tests 65
ℹ pass 64
ℹ fail 0
ℹ skipped 1
```

## Residual Risks

- **El diagnóstico es una foto del ruleset**: entre la consulta y el merge el ruleset puede cambiar. El informe dice cómo volver a mirarlo (`pnpm ci:gate`), pero no lo bloquea.
- **La cola de merge sigue sin activarse**: es la configuración del ruleset y GitHub no la expone por API para este repo. Queda como acción de Nicolás (escala humana), documentada en `docs/control-ci.md`. Con «rama al día» desactivada (el estado actual) el merge no se rechaza por desfasaje, así que el ciclo no se reproduce; si alguien reactiva «rama al día» sin activar la cola de merge, el ciclo vuelve — por eso el script lo dice explícitamente en el veredicto `bloqueado`.
- **Los pasos de merge del flujo** (`merge-con-revisiones.sh`, `merge-seguro.sh`) no están versionados en este repo: no se pudo verificar si consultan el gate por el endpoint clásico. La cobertura de MSF-755 es el gate de GitHub y el runbook del repo.
- La cola del CI (~1 h en los runners self-hosted, la del síntoma original) no se midió en esta corrida: no es código del repo y no cambia con este arreglo.

## Recommendation

**Cerrar el bug — verificado en el repo.** El diagnóstico se hace por el endpoint correcto, la trampa del 404 queda documentada y el runbook no vuelve a mandar a resincronizar la rama. Queda una sola acción, que no es de código y es decisión de Nicolás: activar la «Merge queue» del ruleset `dokploy-integracion-protegida` (documentada con el camino exacto).
