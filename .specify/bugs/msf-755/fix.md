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

### Tercera vuelta (2026-11-20) — devolución de la revisión (PR #1147)

El revisor pidió cambios sobre el HEAD `570f0ed2bc0b`. Se atendieron los ocho
hallazgos accionables de la revisión más los dos de seguridad, todos de esta
historia:

| Hallazgo | Corrección | Dónde está |
|---|---|---|
| `docs/tecnico/runbooks/ci-trabado.md:28` ordenaba «actualizar la rama» ante un merge por «rama atrás» (justo la instrucción que genera el ciclo) | el paso 5 del runbook manda a mirar el gate con `pnpm ci:gate -- --pr <n>` y a no resincronizar a ciegas; el guard de docs ahora mira **esa** página | `scripts/gate-integracion.test.mjs`, describe «runbooks» |
| `scripts/gate-integracion.mjs`: si el detalle de un ruleset no se podía leer, el ruleset se descartaba en silencio y el informe caía en «sin gate» (falso verde) | la lectura de la API pasa por una función **pura** `gateDesdeRespuestas` que **falla** si un detalle no se pudo leer (o si la protección clásica no se pudo leer) | `gateDesdeRespuestas` |
| `aplicaA` comparaba `ref_name` exacto y no veía los patrones fnmatch (`refs/heads/*` daba «sin gate» con un ruleset activo) | `coincidePatron` implementa el fnmatch de GitHub (`*` no cruza `/`, `**/` = cero o más directorios y un `**` suelto equivale a `*`) y los tokens `~ALL` / `~DEFAULT_BRANCH` | `coincidePatron`, `aplicaA` |
| la capa de lectura de la API no tenía ningún test (una regresión al endpoint clásico no la detectaba nadie) | `gateDesdeRespuestas` es pura y se testea con el **payload real** del ruleset `25358575` (lista + detalle + 404) y con la protección clásica | `scripts/gate-integracion.test.mjs`, describe «gateDesdeRespuestas» |
| `docs/manifest.json` quedó con la deriva de `docs/control-ci.md` (el HEAD cambió una fuente declarada sin tocar la página) | la página se actualizó y el manifest se regeneró (`pnpm docs:manifest`): esa página salió de la lista de deriva | `node scripts/docs-drift.mjs` → 18 páginas (las 18 preexistentes), sin `docs/control-ci.md` |
| `GITHUB_BASE_REF` pisaba la base documentada (`dokploy`) y no figuraba en la cabecera de uso (en un job de CI de un PR a `main` el informe hablaba del gate de `main`) | la base por defecto es **siempre** `dokploy`; `--base <rama>` la cambia a propósito y `GITHUB_BASE_REF` dejó de usarse. La cabecera de uso documenta `--repo`, `--base`, `--pr` y `--json` | cabecera de uso del script |
| sin `--pr`, con «rama al día» exigida el informe no daba veredicto y salía con 0 | el informe da el veredicto, avisa del ciclo y dice cómo ver el desfasaje (`pnpm ci:gate -- --pr <n>`) | test «sin PR y con «rama al día» exigida…» |
| `docs/decisiones-2026-11-17.md` («no se cambian las reglas de GitHub», premisa «la protección de rama es de pago en repos privados») contradecía el bullet de la cola de merge de `docs/control-ci.md` | la decisión de MSF-755 se corrige: el gate es un ruleset activo (la premisa era falsa) y activar la «Merge queue» queda explícitamente como decisión de Nicolás | `docs/decisiones-2026-11-17.md` |
| **Seguridad**: `spawnSync('gh')` sin timeout (un `gh` colgado dejaba el proceso esperando) | `timeout` de 60 s y `killSignal` | `gh()` |
| **Seguridad**: «sin gate» con la protección clásica activa (200) | el script lee **también** `/branches/<rama>/protection`: un 200 **es** un gate (GitHub acumula rulesets y protección clásica) y se informa como tal | `agregaProteccionClasica` + test |

Además, al revisar el propio diff apareció un bug del round anterior: el estado
HTTP se sacaba del **código de salida** de `gh`, así que una llamada exitosa
(exit 0) quedaba en «HTTP 0» y la rama de la protección clásica (un 200) era
inalcanzable. El mapeo quedó en la función pura `estadoDeGh` (exit 0 = 200; si
no, el estado HTTP del cuerpo del error) con sus tests.

Sin cambios de alcance: no se tocó el workflow, ni las reglas de GitHub, ni el
ruleset (la cola de merge sigue siendo acción de Nicolás).

Verificación de esta vuelta:

- `node --test scripts/gate-integracion.test.mjs` → **23 tests, 23 pass, 0 fail** (la suite pasó de 10 a 23 con los casos de la capa de API, los patrones fnmatch, la protección clásica, el veredicto sin `--pr`, el guard del runbook y el mapeo del código de salida de `gh`).
- `pnpm test:ci` → **78 tests, 77 pass, 1 skipped, 0 fail**.
- `pnpm test:docs:check` → 171 tests, 171 pass, 0 fail.
- `pnpm docs:check` → Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos) · Trampas conocidas OK.
- `pnpm lint` → exit 0 (los warnings de `set-state-in-effect` son preexistentes, en archivos que este cambio no toca) · `pnpm build` → exit 0.
- `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack **ok**; gitleaks no corrió (sin permisos del socket de Docker en este entorno; el job `quality` del CI lo corre).
- `node scripts/docs-drift.mjs` → 18 páginas con deriva (las 18 preexistentes de la base): `docs/control-ci.md` ya no está en la lista.
- `node scripts/gate-integracion.mjs` → el gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida) + el aviso del 404 + veredicto, exit 0.
- `node scripts/gate-integracion.mjs --pr 1147` → «La rama está al día con la base» + veredicto, exit 0.
- **FEAT-236 (8 mutaciones, 8 detectadas):** `strict_required_status_checks_policy === true` → `=== false`; el fallo ruidoso del detalle → silencioso; el fnmatch → nombre exacto; la protección clásica → ignorada; el veredicto sin `--pr` → eliminado; el runbook → la instrucción vieja; la salida 0 de `gh` → HTTP 0 en vez de 200; y la protección clásica 200 sin cuerpo → silenciosa. En los ocho casos falla la suite; revertido, los 23 vuelven a verde.

### Cuarta vuelta (2026-11-21) — devolución de la revisión (PR #1147, SHA `84ca53fab8c`)

El revisor pidió cambios sobre el HEAD `84ca53fab80c`. Se atendieron los seis
hallazgos técnicos y el de seguridad, todos de esta historia:

| Hallazgo | Corrección | Dónde está |
|---|---|---|
| **Media** · `regexDePatron` no era el fnmatch de GitHub (escapaba `[]` como literales y compilaba un `**` suelto a `.*`) | `regexDePatron` reimplementa el fnmatch de GitHub: `File.fnmatch` de Ruby con `File::FNM_PATHNAME`. `*` no cruza `/`, `?` matchea un carácter (nunca `/`), `[]` es un juego de caracteres (con negación `!`), `**/` matchea cero o más niveles de directorio y un `**` **suelto** equivale a `*`. Un patrón que no se puede interpretar (una `[` sin cerrar) **falla en voz alta** en vez de ignorarse | `scripts/gate-integracion.mjs`, `regexDePatron` |
| **Media** · `~DEFAULT_BRANCH` se resolvía sólo desde `include`: con el token en `exclude` el script abortaba con exit 2 y no había veredicto | la rama por defecto se pide si el token está en `include` **o** en `exclude` | `necesitaRamaPorDefecto` + `ramaPorDefectoDe` |
| **Baja** · el comodín `?` sin test | caso `?` en la suite de patrones | `scripts/gate-integracion.test.mjs` |
| **Baja** · el código de salida `2` documentado como «no se pudo leer el gate», pero el script también devuelve `2` si no se puede leer el PR o la comparación | la documentación dice «no se pudo determinar el veredicto (no se pudo leer el gate, el PR ni la comparación)» | `docs/control-ci.md` |
| **Baja** · la misma acción pendiente (activar la «Merge queue») escrita en tres lugares, que se desincronizarían | queda **un solo** lugar, «Pendientes del lote 36 que necesitan acción de Nicolás» (`docs/control-ci.md`); los otros dos (§ «Cola de merge» y `docs/decisiones-2026-11-17.md`) apuntan ahí | `docs/control-ci.md`, `docs/decisiones-2026-11-17.md` |
| **Baja** · el ejemplo de la API mostraba `DELETE` etiquetado como «desactivar» (DELETE **borra** el ruleset) | el ejemplo es `PUT … -f enforcement=disabled` | `docs/control-ci.md` |
| **Baja (seguridad)** · `--repo`/`--base` se interpolaban en la ruta de la API sin validar | `--repo` tiene que ser `owner/nombre` y `--base` un nombre de rama; si no, el script sale con `2` **antes** de consultar la API | `esRepoValido`, `esRamaValida` + `main()` |

La evidencia de la semántica del matcher no es una suposición: la API de rulesets
de GitHub usa `File.fnmatch` de Ruby con `File::FNM_PATHNAME` (la documentación
de GitHub lo dice y enlaza la doc de Ruby 2.5.1). Del código de Ruby
(`dir.c`, `fnmatch`) sale que `**/` es la forma recursiva (detecta `*`,`*`,`/` y
reintenta en cada nivel) y que un `**` que no va seguido de `/` cae en la rama
de `*`, que con `FNM_PATHNAME` no cruza `/`. Por eso `refs/heads/release/**`
cubre **un** nivel y `refs/heads/release/**/*` los cubre todos.

Los tests que fijan el comportamiento nuevo: `[]` (incluida la clase negada),
`?`, `**` suelto, `**/` recursivo, el patrón inválido que falla en voz alta,
`~DEFAULT_BRANCH` en `exclude` y el rechazo de `--repo`/`--base` inválidos desde
la línea de comandos.

Verificación de esta vuelta:

- `node --test scripts/gate-integracion.test.mjs` → **34 tests, 34 pass, 0 fail** (23 antes + 11 nuevos).
- `pnpm test:ci` → **89 tests, 88 pass, 1 skipped, 0 fail**.
- `pnpm test:docs:check` → **171 tests, 171 pass, 0 fail**.
- `pnpm docs:check` → Documentación de cambios OK (4256 archivos contra la base) · Migraciones OK (771 archivos, 0 nuevos) · Trampas conocidas OK.
- `pnpm lint` → exit 0 · `pnpm build` → exit 0.
- `node scripts/docs-drift.mjs` → 18 páginas con deriva (las 18 preexistentes de la base): `docs/control-ci.md` no está en la lista.
- `node scripts/gate-integracion.mjs` → el gate real (ruleset `25358575`, check `validacion`, «rama al día» NO exigida) + el aviso del 404 + veredicto, exit 0.
- `node scripts/gate-integracion.mjs --pr 1147` → «La rama está al día con la base» + veredicto, exit 0.
- **FEAT-236 (8 mutaciones, 8 detectadas):** `**/` sin recursión; `[]` como literal; `~DEFAULT_BRANCH` sólo desde `include`; el comodín `?` eliminado; `--repo`/`--base` sin validar; el patrón inválido ignorado en silencio; una clase que matchea la `/`; y `*` cruzando la `/`. En los ocho casos falla la suite; revertido, los 34 vuelven a verde.

### Quinta vuelta (2026-11-21) — devolución de la revisión (SHA `6d18175e1d`)

El revisor pidió cambios sobre el HEAD `6d18175e1d`. Se atendieron los seis
hallazgos técnicos y el de seguridad de esta vuelta (siete correcciones: el
hallazgo de `--repo`/`--base` y el de `\` aparecen en las dos listas), todos del
matcher fnmatch y de la validación de argumentos de esta historia:

| Hallazgo | Corrección | Dónde está |
|---|---|---|
| **Media** · `regexDePatron` trataba `^` como complemento del juego, pero GitHub documenta que no se complementa con `^`: daba falso «no hay gate» sobre ramas que GitHub sí protege | sólo `!` niega; el `^` es un miembro literal más del juego | `scripts/gate-integracion.mjs`, `regexDePatron` |
| **Baja** · `\` se interpretaba como escape dentro de `[]` (y se copiaba crudo a la regex de JS: `[\d]` matcheaba dígitos) y un patrón terminado en `\` abortaba con exit 2; GitHub no soporta `\` como carácter de citación | `\` es literal dentro y fuera de `[]` (se escapa para JS) y un patrón terminado en `\` no aborta: el juego se cierra con el fin del patrón | `regexDePatron` |
| **Baja** · ningún test cubría `[^...]` ni `\` dentro de `[]` (borrar esas ramas dejaba la suite verde) | casos nuevos: `[^charset]` (el ejemplo de la doc) protege `refs/heads/abc` como en GitHub; `[\*]` matchea `\` y `*`; un patrón terminado en `\` no aborta | `scripts/gate-integracion.test.mjs` |
| **Baja/Media (seguridad)** · `esRepoValido`/`esRamaValida` aceptaban segmentos `.`/`..` (`owner/..`, `../otro`, `a/./b`): el cliente HTTP normaliza la ruta y consulta otra rama | se rechaza cualquier segmento `.`/`..` antes de la API | `esRepoValido`, `esRamaValida` + tests de CLI |
| **Baja** · la vuelta del SHA `84ca53fab8c` se titulaba «Cuarta» en `fix.md` y «Quinta» en `test.md` | numeración alineada (la revalidación de `fdbf6741ef` deja de numerarse como vuelta) | `fix.md`, `test.md` |
| **Baja** · el conteo «seis técnicos y cuatro de seguridad» (10) no cerraba con las 7 filas de la tabla | conteo corregido a «seis técnicos y el de seguridad» (7) | `fix.md`, `test.md` |
| **Baja (seguridad)** · `fix.md` decía que «`**` sí» cruza `/`, contradiciendo la semántica corregida | queda «`**/` cruza y un `**` suelto equivale a `*`» | `fix.md` |

Evidencia de la fuente: GitHub documenta, en «Unsupported `fnmatch` syntax», que
«you cannot currently complement a set with the `^` operator» y que «you cannot
use the backslash (`\`) character as a quoting character»
(`creating-rulesets-for-a-repository#unsupported-fnmatch-syntax`); el matcher
respeta las dos restricciones. El escenario del revisor —el ejemplo `[^charset]`
de la propia documentación— queda cubierto por un test: con ese patrón GitHub
protege `refs/heads/abc` y el script también, así que ya no puede responder
«no hay gate» de una rama que GitHub protege.

Verificación de esta vuelta:

- `node --test scripts/gate-integracion.test.mjs` → **36 tests, 36 pass, 0 fail**.
- `pnpm test:ci` → **91 tests, 90 pass, 1 skipped, 0 fail**.
- `pnpm test:docs:check` → 171 tests, 171 pass, 0 fail.
- `pnpm docs:check` → Documentación de cambios OK · Migraciones OK (0 nuevos) · Trampas conocidas OK.
- `pnpm lint` → exit 0 · `pnpm build` → exit 0.
- **FEAT-236 (6 mutaciones, 6 detectadas):** volver `^` a complemento; volver el escape de `\` dentro de `[]`; dejar de escapar la `\` fuera de `[]`; quitar el cierre implícito del juego terminado en `\`; y sacar el rechazo de `.`/`..` en `--repo` y en `--base`. En los seis casos falla la suite; revertido, los 36 vuelven a verde.

## Deviations from Assessment


- La assessment proponía, como alternativa, «sólo corregir el texto de `docs/control-ci.md`». Se hizo **además** el script porque el texto solo no alcanza: la API devuelve el 404 y es la respuesta más obvia de cualquiera que diagnostique el gate. El script no modifica nada: es de sólo lectura.
- El assessment mencionaba «un guard de documentación» como parte del remediation; se implementó dentro del archivo de tests del script (describe «runbook») en vez de un script aparte, para no sumar un archivo más al repo. En la tercera vuelta ese guard pasó a mirar las **dos** páginas que mandaban a resincronizar la rama (`docs/control-ci.md` y el runbook `docs/tecnico/runbooks/ci-trabado.md`).
- La assessment pedía «una función pura que reciba lista+detalle+404»: se implementó `gateDesdeRespuestas` con esa forma exacta (lista de rulesets + mapa de detalles + respuesta de la protección clásica). Además se le agregaron la protección clásica como gate y el fallo ruidoso, que pidió la revisión.

## Follow-ups

- **Cola de merge (decisión de Nicolás, escala humana):** activar la regla «Merge queue» del ruleset `dokploy-integracion-protegida` (Settings → Rules → Rulesets). GitHub no expone `merge_queue` por API para este repo (`GET /rulesets/25358575/merge-queue` → 404), y `validate.yml` ya tiene el trigger `merge_group`, así que no hay que tocar el repo. Queda anotado en `docs/control-ci.md`, «Pendientes del lote 36 que necesitan acción de Nicolás».
- **Los pasos de merge del flujo** (`merge-con-revisiones.sh`, `merge-seguro.sh`) no están versionados en este repo: el diagnóstico de MSF-755 cubre el gate de GitHub y el runbook. Si el flujo tiene su propio punto de consulta del gate, conviene que use `pnpm ci:gate` en vez de `/branches/<rama>/protection`.
- El informe del script es una foto del ruleset: puede cambiar entre la consulta y el merge. Por eso el texto dice cómo volver a mirarlo.
