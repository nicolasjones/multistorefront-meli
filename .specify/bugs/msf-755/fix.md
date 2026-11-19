# Bug Fix: el gate de integración de `dokploy` se diagnostica por el endpoint equivocado

- **Slug**: msf-755
- **Fixed**: 2026-11-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El gate de `dokploy` es un **ruleset** y se lee por la API de rulesets; el 404 de
`/branches/<rama>/protection` («Branch not protected») es engañoso y era la causa
del diagnóstico incorrecto que terminaba en el ciclo `BEHIND → resincronizar → CI
→ BEHIND`. Se agrega `scripts/gate-integracion.mjs` (`pnpm ci:gate`), que lee el
ruleset, avisa de la trampa y da el veredicto sin pedir resincronizar la rama
cuando el gate no exige «rama al día», y se corrige el runbook (`docs/control-ci.md`),
que mandaba a actualizar la rama y reintentar ante un «head branch is not up to date».

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/gate-integracion.mjs` | added | Diagnóstico de sólo lectura del gate por rulesets. La decisión (`gateDe`, `informe`, `aplicaA`) es pura y testeable; la lectura de la API (`leerGate`, `atrasDe`) queda aparte. Salida: estado (`sin-gate` / `no-bloqueado` / `bloqueado`), checks requeridos, si exige «rama al día», bypass, cola de merge y la advertencia de la trampa del 404. Con `--pr <n>` compara la rama con la base y avisa cuántos commits está atrás. |
| `scripts/gate-integracion.test.mjs` | added test | 10 tests: gate efectivo (rulesets activos / de otra rama / `include`/`exclude` de `ref_name`), la decisión (con «rama al día» exigida ⇒ bloqueado; sin ella ⇒ no pide resincronizar), la trampa del 404 (ruleset activo + 404 ⇒ NO dice que no hay protección; sin ruleset + 404 ⇒ sí lo dice) y el guard del runbook. |
| `package.json` | modified | `ci:gate` (el diagnóstico) y el test nuevo en la suite `test:ci`. |
| `docs/control-ci.md` | modified | Sección «El gate se lee por rulesets…» con la trampa del 404 y el comando correcto; se borra la «Consecuencia operativa» que mandaba a resincronizar la rama; bullet de runbook para el PR `BEHIND`; la cola de merge queda como acción de Nicolás. |
| `docs/manifest.json` | modified | Regenerado (`pnpm docs:manifest`): cambia sólo la página `docs/control-ci.md`. |

## Diff Highlights

La decisión que rompe el ciclo, en `scripts/gate-integracion.mjs`:

```js
if (gate.ramaAlDia && atras > 0) {
  lineas.push('  Veredicto: BLOQUEADO — el gate exige «rama al día», así que «gh pr merge» va a fallar con "head branch is not up to date".');
  ...
}
// «rama al día» no exigida: el merge NO se rechaza por desfasaje.
lineas.push('  Veredicto: el merge NO se rechaza por desfasaje: no actualices la rama, esperá el check requerido en verde y mergeá.');
```

Y la trampa, explícita en el informe:

```js
if (proteccionClasica404) {
  lineas.push(`  Aviso: /branches/${gate.rama}/protection devuelve 404 ("Branch not protected"): ese endpoint es la protección clásica y NO ve los rulesets.`);
  lineas.push(`  El gate real es el ruleset «${gate.reglas[0].nombre}» (id ${gate.reglas[0].id}): no concluyas que se puede mergear sin su check requerido.`);
}
```

## Tests Added or Updated

- `scripts/gate-integracion.test.mjs::gateDe` — el gate efectivo sale de los rulesets **activos** que cubren la rama: ignora los `disabled`, los de otra base y los de target `tag`.
- `scripts/gate-integracion.test.mjs::aplicaA` — `include`/`exclude` de `conditions.ref_name` (sin `include`, aplica a todas las ramas menos las excluidas).
- `scripts/gate-integracion.test.mjs::informe` — con «rama al día» exigida y la rama atrás, el veredicto es `bloqueado` y nombra el error real («head branch is not up to date») y las dos salidas; sin «rama al día», el veredicto es `no-bloqueado` y NO pide resincronizar la rama.
- `scripts/gate-integracion.test.mjs::informe` (trampa) — ruleset activo + 404 en el endpoint clásico ⇒ el informe nombra el ruleset (id y nombre) y no dice que no hay gate; sin ruleset + 404 ⇒ sí dice que no hay gate.
- `scripts/gate-integracion.test.mjs::runbook` — `docs/control-ci.md` sigue nombrando el endpoint de rulesets y la trampa del 404, y no vuelve a la instrucción de resincronizar la rama.

## Local Verification

- `node --test scripts/gate-integracion.test.mjs` → 10 tests, 10 pass, 0 fail.
- `pnpm test:ci` → 65 tests, 64 pass, 1 skipped, 0 fail (incluye la suite nueva).
- `pnpm test:docs:check` → 171 tests, 171 pass, 0 fail.
- `pnpm docs:check` → Documentación de cambios OK (4251 archivos contra `origin/main`) · Migraciones OK (771 archivos, 0 nuevos) · Trampas conocidas OK.
- `node scripts/docs-check.mjs` → nav 219 páginas, links internos 2003, Documentación OK.
- `pnpm lint` → exit 0 (los warnings de `set-state-in-effect` son preexistentes, en archivos no tocados).
- `pnpm build` → `✓ built in 5.96s`, exit 0.
- `node scripts/gate-integracion.mjs` → estado real del ruleset `25358575` + la advertencia del 404, exit 0.
- `node scripts/gate-integracion.mjs --pr 1146` → «La rama está al día con la base» + veredicto, exit 0.
- **El test vigila la regla (FEAT-236):** se cambió a propósito `strict_required_status_checks_policy === true` por `=== false` en el script y fallaron 4 tests (los que fijan la decisión y la trampa); se revirtió y los 10 volvieron a verde.

### Segunda vuelta (2026-11-19)

Revalidé el arreglo sobre el HEAD real (`320706c01`) sin tocar el código: el árbol queda igual salvo la corrección de las cifras de esta bitácora.

- `node --test scripts/gate-integracion.test.mjs` → **10 tests, 10 pass, 0 fail** (la suite tiene 10 `it`; la cifra «11» de la primera vuelta estaba mal y se corrigió acá y en `test.md`).
- `pnpm test:ci` → 65 tests, 64 pass, 1 skipped, 0 fail.
- `pnpm test:docs:check` → 171 tests: 170 pass y 1 falla **flake de línea base** (`recorrerSql rendimiento: miles de etiquetas $tN$…`, umbral de 500 ms; `scripts/verificar-trampas-conocidas.test.mjs` es **idéntico a `origin/dokploy`**). Al correrlo solo, pasa.
- `pnpm docs:check` → Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos) · Trampas conocidas OK.
- `pnpm lint` → exit 0 · `pnpm build` → exit 0 · `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack **ok** (gitleaks no corrió: sin permisos del socket de Docker en este entorno; el job `quality` del CI lo corrió y salió verde).
- `node scripts/gate-integracion.mjs --pr 1147` → «La rama está al día con la base» + veredicto, exit 0.
- FEAT-236 repetido en esta vuelta: con `strict_required_status_checks_policy === false` en el script fallan **4** tests; revertido, los 10 vuelven a verde.

## Deviations from Assessment

- La assessment proponía, como alternativa, «sólo corregir el texto de `docs/control-ci.md`». Se hizo **además** el script porque el texto solo no alcanza: la API devuelve el 404 y es la respuesta más obvia de cualquiera que diagnostique el gate. El script no modifica nada: es de sólo lectura.
- El assessment mencionaba «un guard de documentación» como parte del remediation; se implementó dentro del archivo de tests del script (describe «runbook») en vez de un script aparte, para no sumar un archivo más al repo.

## Follow-ups

- **Cola de merge (decisión de Nicolás, escala humana):** activar la regla «Merge queue» del ruleset `dokploy-integracion-protegida` (Settings → Rules → Rulesets). GitHub no expone `merge_queue` por API para este repo (`GET /rulesets/25358575/merge-queue` → 404), y `validate.yml` ya tiene el trigger `merge_group`, así que no hay que tocar el repo. Queda anotado en `docs/control-ci.md`, «Pendientes del lote 36 que necesitan acción de Nicolás».
- **Los pasos de merge del flujo** (`merge-con-revisiones.sh`, `merge-seguro.sh`) no están versionados en este repo: el diagnóstico de MSF-755 cubre el gate de GitHub y el runbook. Si el flujo tiene su propio punto de consulta del gate, conviene que use `pnpm ci:gate` en vez de `/branches/<rama>/protection`.
- El informe del script es una foto del ruleset: puede cambiar entre la consulta y el merge. Por eso el texto dice cómo volver a mirarlo.
