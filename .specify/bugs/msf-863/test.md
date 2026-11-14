# Bug Verification: fila «Empresa activa» en la matriz de la spec 023

- **Slug**: msf-863
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma no se reproduce: con la fila «Empresa activa» agregada a la matriz de `specs/023-visor-componentes/spec.md`, el gate `pnpm matriz:check` pasa contra la base real del PR (`origin/dokploy`) con el mismo mensaje que daba el CI. Se reprodujo el fallo antes del arreglo (exit 1, mismo texto que el log del run 43482415728) y se comprobó que pasa después (exit 0). No hubo regresiones en los chequeos que el job `application` corre. En la tercera vuelta la rama se sincronizó con `dokploy` (merge `24d73b49`, único conflicto resuelto con el mismo contenido de la rama de integración) para dejar el PR #934 mergeable, y se volvieron a correr los 14 pasos del job `application` que no dependen de la base ni del navegador: todos en verde. En la cuarta vuelta `dokploy` volvió a avanzar a `fbd3d565` y el PR regresó a `CONFLICTING`; se re-sincronizó sin conflictos (`858b85b1`) y quedó `MERGEABLE` (sólo `BLOCKED` por `validacion` en curso), con los gates locales en verde. En la quinta vuelta, la devolución del Revisor: se corrigió el follow-up de `knip` que describía un estado inexistente, se endureció el gate para que exija la **fila** «Empresa activa» (con test de rechazo y con la lista de exentas para no romper los PRs de épica contra `main`) y se corrigió la evidencia de la fila «Estado del PR». En la sexta vuelta `dokploy` volvió a avanzar 22 commits (`0c749324`) y la rama quedó atrás de la base: se re-sincronizó sin conflictos (`352dc359`, 0 atrás / 10 adelante) y se comprobó, con evidencia, que los tres hallazgos del Revisor ya estaban atendidos en los commits posteriores al SHA revisado (`f5d48cc9`): el gate exige la fila «Empresa activa» y su test de rechazo **falla** con el regex viejo. En la séptima vuelta el CTO devolvió el PR por `CONFLICTING`/`DIRTY`: la rama estaba 10 commits atrás de `origin/dokploy` (`a1017fff`), se re-sincronizó sin conflictos (`49b80e3f`, 0 atrás / 14 adelante) y se recomprobaron los tres hallazgos contra el árbol mergeado.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` | fail | Exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo). - specs/023-visor-componentes/spec.md` (idéntico al log del CI) |
| Reproduction (post-fix) | `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` | pass | Exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).` |
| New / updated tests | `pnpm test:matriz:pantalla` | pass | 14/14 (era 10/10: en la quinta vuelta se modificó el archivo con el test de rechazo, el de la exención y los dos de la lista) |
| Estructura de la tabla | conteo de celdas de la fila «Empresa activa» contra el encabezado | pass | 2 celdas = 2 columnas del encabezado (la primera versión tenía 3 y el criterio se perdía al renderizar) |
| CI (PR #929) | run `43491976550`, job `application` id `132131028268` | pass | `application` en success sobre el SHA `73de5501`: `pnpm matriz:check` pasó contra `origin/dokploy` |
| CI (PR #934) | run `43492109016`, job `validacion` id `132126092325` | pass | `validacion` en success (único check requerido de `dokploy`) |
| Regression suite | `GITHUB_BASE_REF=dokploy pnpm docs:check` · `pnpm prototipo:check` · `pnpm lint` · `pnpm build` | pass | docs:check OK (596 archivos contra origin/dokploy) · migraciones OK · prototipo OK (120 pantallas) · lint exit 0 · build `✓ built` |
| Lint / type-check | `pnpm lint` | pass | Exit 0; sólo warnings de oxlint preexistentes del PR #929 |
| Calidad determinista | `pnpm calidad` | partial | oxlint/jscpd/dependency-cruiser/syncpack **ok**. gitleaks no corrió (sin Docker en este entorno) y **knip da 0 hallazgos**: el `knip.json` de `dokploy` ya declara el tooling de evidencia E2E que trae de `main` (commit `d345eeb1`), así que no hay nada pendiente de ese check |

### Tercera vuelta: verificación tras el sync con `dokploy` (commit `24d73b49`)

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Merge de la base | `git merge origin/dokploy` | pass | Un único conflicto (`docs/solicitar-acceso.md`), resuelto con el mismo contenido que la rama de integración (`34cd63a2`) → `git diff 34cd63a2 HEAD` vacío |
| Estado del PR | `gh pr view 934 --json mergeable,mergeStateStatus` | pass | Antes del sync: `CONFLICTING` / `DIRTY`; después del merge `858b85b1`: `MERGEABLE` / `BLOCKED` (el `BLOCKED` es el check requerido `validacion` en curso, no un conflicto) |
| Pasos del job `application` | `docs:check` · `test:docs:pasos-manuales` · `test:db:guard-migraciones` · `estilos:check` · `test:estilos:sueltos` · `e2e:escritura:check` · `test:e2e:escritura` · `test:e2e:omitidos` · `ui:empresas:check` · `test:ui:empresas` · `prototipo:check` · `test:prototipo:inventario` · `matriz:check` · `test:matriz:pantalla` | pass | 14/14 OK contra el árbol mergeado |
| Gate de la regla | `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` | pass | Exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).` |
| Tests de la regla | `pnpm test:matriz:pantalla` | pass | 10/10 (en esa vuelta; hoy 14/14) |
| Lint | `pnpm lint` | pass | Exit 0 (warnings preexistentes) |
| Build | `pnpm build` | pass | `✓ built` |
| Tests de lo que trae el merge | `pnpm test:edge:enviar-aviso-faltante` | pass | 126/126 (configuración SMTP de PR #930/#931, traída por `dokploy`) |
| Migraciones | `ls supabase/migrations | tail` | pass | `20270307110000_evidencias_e2e.sql` es la mayor; por encima de `20270307100000_service_role_grants_tablas_public_e2e.sql` (PR #923) |
| Calidad determinista | `pnpm calidad` | partial | oxlint/jscpd/dependency-cruiser/syncpack **ok**; gitleaks sin Docker; knip **ok** (0 hallazgos: `knip.json` ya declara el tooling de `main` desde `d345eeb1`) |

### Cuarta vuelta: verificación tras el re-sync con `dokploy` (commit `858b85b1`)

`origin/dokploy` avanzó a `fbd3d565` (43 commits, PR #929 ya mergeado) y el PR
#934 volvió a `CONFLICTING` / `DIRTY`. Se mergeó `origin/dokploy` sobre la rama
sin conflictos (`858b85b1`). Tras el merge sólo difieren de la base estos dos
informes del bug: la fila «Empresa activa» de la spec 023 ya vive en `dokploy`
por el PR #929.

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Merge de la base | `git merge origin/dokploy` | pass | Sin conflictos → `858b85b1`; `git diff --stat origin/dokploy..HEAD` = sólo `.specify/bugs/msf-863/{fix,test}.md` |
| Estado del PR | `gh pr view 934 --json mergeable,mergeStateStatus` | pass | `MERGEABLE` / `BLOCKED` (ya no `CONFLICTING`/`DIRTY`); `BLOCKED` por `validacion` en curso |
| Gate de la regla | `GITHUB_BASE_REF=dokploy pnpm matriz:check` | pass | OK (0 specs nuevas revisadas; la spec 023 ya está en la base) |
| Docs + migraciones | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | `Migraciones OK: 649 archivo(s), 0 nuevo(s)` |
| Prototipo | `pnpm prototipo:check` | pass | 120 pantallas al día |
| Tests de la regla | `pnpm test:matriz:pantalla` | pass | 10/10 (en esa vuelta; hoy 14/14) |
| Estilos / lint | `pnpm estilos:check` · `pnpm lint` | pass | Exit 0 (warnings preexistentes) |
| Job `quality` (CI) | `gh pr checks 934` | pass | 1m22s sobre `858b85b1` |

### Quinta vuelta: devolución del Revisor (PR #934, SHA `f5d48cc9`)

El Revisor pidió tres cambios y se atendieron los tres (ver `fix.md`): el
follow-up de `knip` describía un estado inexistente, el gate no exigía la fila
«Empresa activa» y una evidencia del informe no era evidencia. Los checks de
esta vuelta:

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Test de rechazo (detecta la regla) | `pnpm test:matriz:pantalla` con el regex viejo (`/empresa/i`) | fail | El caso nuevo «rechaza una matriz que sólo menciona «empresa»…» falla (`actual: null`, `expected: <spec.md>`): el test vigila la regla y no pasa por casualidad |
| Tests de la regla | `pnpm test:matriz:pantalla` | pass | 14/14 (antes 10/10) |
| Gate de la regla (base del PR) | `GITHUB_BASE_REF=dokploy pnpm matriz:check` | pass | OK (0 specs nuevas revisadas) |
| Gate contra `main` (épicas) | `MATRIZ_CHECK_BASE=origin/main node scripts/verificar-matriz-pantalla.mjs` en un worktree de `origin/epic/MSF-140-…` | pass | Con el regex estricto: exit 1 y 10 specs listadas (habría roto 14 PRs de épica abiertos). Con la lista de exentas: exit 0 («47 specs nuevas revisadas») |
| Gate rechaza una spec nueva sin la fila | spec de prueba en el worktree temporal | pass | exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa»…`; al agregar la fila: exit 0 |
| Estado real de `knip` | `pnpm calidad` | pass | `knip (código muerto): ok` (0 hallazgos); `knip.json` ya declara los 6 desde `d345eeb1` (ancestro de `origin/dokploy`) |
| Estado real del job `quality` | `gh pr checks 934` | pass | `quality pass 1m6s` (run `43547159355`) |
| Archivos del hallazgo de `knip` | `git cat-file -e origin/dokploy:<archivo>` | pass | Los 3 existen en `origin/dokploy` (el informe decía que no) |
| Estado del PR | `gh pr view 934 --json mergeable,mergeStateStatus` | pass | `MERGEABLE` / `BLOCKED` (por `validacion` en curso) |
| Docs + migraciones | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | Documentación de cambios + migraciones OK |
| Prototipo | `pnpm prototipo:check` | pass | 120 pantallas al día |
| Lint / build | `pnpm lint` · `pnpm build` | pass | Exit 0 (warnings preexistentes) · `✓ built` |

### Sexta vuelta: re-sync con `dokploy` (commit `352dc359`) y comprobación de los tres hallazgos

`origin/dokploy` avanzó 22 commits (`8f2bc380` → `0c749324`) y el PR #934 quedó
atrás de la base. Se mergeó `origin/dokploy` sobre la rama **sin conflictos**
(`352dc359`): la base no toca ningún archivo de esta historia. Tras el merge,
la rama quedó 0 commits atrás y 10 adelante, y `git diff --stat
origin/dokploy...HEAD` = los 6 archivos de la historia.

Los tres hallazgos del Revisor (SHA revisado `f5d48cc9`) ya estaban atendidos
en los commits posteriores a ese SHA; se comprobó con evidencia, sin re-tocar
lo hecho:

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Hallazgo 1 · `knip` (Media) | `pnpm calidad` | pass | `knip (código muerto): ok` (0 hallazgos). La afirmación obsoleta ya no está en `fix.md` ni en `test.md`: en `fix.md:148-161` queda documentada **como corregida** (con la tabla de qué se afirmaba / qué es cierto / la prueba) y el follow-up se borró (`fix.md:234`). Commit `3f9e3094` |
| Hallazgo 2 · regex del gate (Media) | `scripts/verificar-matriz-pantalla.mjs:23` · `scripts/verificar-matriz-pantalla.test.mjs:59` | pass | `MENCION_EMPRESA = /empresa\s+activa/i` + test de rechazo. Commit `f7affd2a` |
| Hallazgo 3 · evidencia de `test.md:32` (Baja) | `test.md:32` | pass | La fila trae el comando real (`gh pr view 934 --json mergeable,mergeStateStatus`) y su salida real. Commit `3f9e3094` |
| Prueba de mutación del hallazgo 2 | el regex viejo `/empresa/i` en vez de `/empresa\s+activa/i` | fail | `pass 13 · fail 1`: falla «rechaza una matriz que sólo menciona «empresa»…». El test vigila la regla; el cambio de prueba se revirtió (`git diff` vacío) |
| Merge de la base | `git merge origin/dokploy` | pass | Sin conflictos → `352dc359`; 0 detrás / 10 adelante |
| Gate de la regla (base del PR) | `GITHUB_BASE_REF=dokploy pnpm matriz:check` | pass | OK (0 specs nuevas revisadas, 0 exentas) |
| Tests de la regla | `pnpm test:matriz:pantalla` | pass | 14/14 |
| Docs + migraciones | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | `Documentación de cambios: OK (6 archivos contra origin/dokploy)` · `Migraciones OK: 651 archivo(s), 0 nuevo(s)` |
| Prototipo | `pnpm prototipo:check` · `pnpm test:prototipo:inventario` | pass | 120 pantallas al día · 3/3 |
| Lint / build | `pnpm lint` · `pnpm build` | pass | Exit 0 (warnings preexistentes) · `✓ built` |
| Calidad determinista | `pnpm calidad` | partial | oxlint / **knip** / jscpd / dependency-cruiser / syncpack **ok**; gitleaks no corrió (sin Docker en este entorno: «permission denied … /var/run/docker.sock») |
| Estado del PR | `gh pr view 934 --json mergeable,mergeStateStatus` | pass | Antes del sync: `CLEAN`/`MERGEABLE` pero 22 commits atrás de la base; después del merge `352dc359`: 0 atrás / 10 adelante |
| CI (PR #934) | run `43555100540`, job `application` id `132326139042` | pass | `application` **success** (2m22s) sobre el SHA `8ff20a6c`: el paso `pnpm matriz:check` pasó contra `origin/dokploy` ya re-sincronizada |
| CI (check requerido) | run `43555100540`, job `validacion` id `132326772942` | pass | `validacion` **success** (6s): único check requerido de `dokploy`, en verde |
| CI (job `quality`) | run `43555100540`, job `quality` id `132326060620` | pass | **success** (1m11s) |
| CI (HEAD `e9ac4ab2`) | run `43555567254` | pass | `application` **success** (3m6s) · `quality` **success** (1m16s) · `changes` **success** (20s) · `infrastructure` **success** (1m8s) · `liberar` **success** (11s) · `validacion` id `132329653954` **success** (6s) |
| Estado final del PR | `gh pr view 934 --json mergeable,mergeStateStatus` | pass | `MERGEABLE` / `CLEAN` (ya no `CONFLICTING` ni `DIRTY`) |

### Séptima vuelta: re-sync con `dokploy` (commit `49b80e3f`) y recomprobación de los tres hallazgos

El CTO devolvió el PR #934 por `mergeable: CONFLICTING` / `mergeStateStatus:
DIRTY`. El estado real: GitHub reportaba `MERGEABLE`/`CLEAN`, pero la rama
quedaba **10 commits atrás** de `origin/dokploy` (`a1017fff`: PRs #957, #958 y
#959), o sea la base había avanzado y el PR podía volver a romperse al
mergear. Se mergeó `origin/dokploy` sobre la rama **sin conflictos**
(`49b80e3f`): `git merge-tree --write-tree HEAD origin/dokploy` → exit 0 y
ningún archivo de esta historia está tocado por la base. Tras el merge: 0
commits atrás, 14 adelante, y el diff contra la base son los mismos 6 archivos.

Los tres hallazgos del Revisor (SHA revisado `f5d48cc9`) se recomprobaron
contra el árbol mergeado:

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Hallazgo 1 · `knip` (Media) | `pnpm calidad` · `git cat-file -e origin/dokploy:<archivo>` · `git merge-base --is-ancestor d345eeb1 origin/dokploy` | pass | `knip (código muerto): ok` (0 hallazgos); los 3 archivos existen en `origin/dokploy`; `d345eeb1` es ancestro de la base; `knip.json:6-7,22,25` declara los 6. La afirmación obsoleta ya no está como follow-up: `fix.md` la cita sólo dentro de la quinta vuelta, que la refuta (`fix.md:148-161`). Commit `3f9e3094` |
| Hallazgo 2 · regex del gate (Media) | `scripts/verificar-matriz-pantalla.mjs:23` · `scripts/verificar-matriz-pantalla.test.mjs:59` | pass | `MENCION_EMPRESA = /empresa\s+activa/i` + test de rechazo. Commit `f7affd2a` |
| Hallazgo 3 · evidencia de `test.md:32` (Baja) | `test.md:32` | pass | Trae el comando real (`gh pr view 934 --json mergeable,mergeStateStatus`) y su salida real. Commit `3f9e3094` |
| Prueba de mutación del hallazgo 2 | regex viejo `/empresa/i` en vez de `/empresa\s+activa/i` | fail | El caso «rechaza una matriz que sólo menciona «empresa»…» falla (`actual: null`, `expected: <spec.md>`). El test vigila la regla; el cambio de prueba se revirtió (`git diff` vacío) |
| Merge de la base | `git merge origin/dokploy` · `git merge-tree --write-tree HEAD origin/dokploy` | pass | Sin conflictos → `49b80e3f`; 0 detrás / 14 adelante; `comm -12` de los archivos de la rama y de la base → vacío |
| Lista de exentas cerrada | specs del repo con UI y sin la fila vs. `scripts/matriz-pantalla-empresa-exentas.txt` | pass | Coinciden exactamente (18 specs): ninguna spec sin exención que el gate pueda rechazar y ninguna exención que ya tenga la fila |
| Tests de la regla | `pnpm test:matriz:pantalla` | pass | 14/14 |
| Gate de la regla (base del PR) | `GITHUB_BASE_REF=dokploy pnpm matriz:check` | pass | OK (0 specs nuevas revisadas, 0 exentas) |
| Docs + migraciones | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | `Documentación de cambios: OK (6 archivos contra origin/dokploy)` · `Migraciones OK: 651 archivo(s), 0 nuevo(s)` |
| Resto de los pasos del job `application` (sin base ni navegador) | `test:docs:pasos-manuales` · `test:db:guard-migraciones` · `estilos:check` · `test:estilos:sueltos` · `e2e:escritura:check` · `test:e2e:escritura` · `test:e2e:omitidos` · `ui:empresas:check` · `test:ui:empresas` · `prototipo:check` · `test:prototipo:inventario` | pass | Todos exit 0 |
| Lint / build | `pnpm lint` · `pnpm build` | pass | Exit 0 (warnings preexistentes) · `✓ built` |
| Calidad determinista | `pnpm calidad` | partial | oxlint / **knip** / jscpd / dependency-cruiser / syncpack **ok**; gitleaks no corrió (sin Docker en este entorno: «permission denied … /var/run/docker.sock») |

## Output Excerpts

```
$ MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs     # antes del arreglo
Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo).
 - specs/023-visor-componentes/spec.md
EXIT=1

$ MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs     # después del arreglo
Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).
EXIT=0

$ pnpm test:matriz:pantalla
ℹ tests 14 · ℹ pass 14 · ℹ fail 0

$ GITHUB_BASE_REF=dokploy pnpm docs:check
Documentación de cambios: OK (596 archivos comparados contra origin/dokploy).
Migraciones OK: 644 archivo(s), 1 nuevo(s) contra origin/dokploy.

$ pnpm prototipo:check
Inventario del prototipo: OK (120 pantallas al día).
```

## Residual Risks

- La verificación local reproduce el paso que falló (`matriz:check` con base `origin/dokploy`), pero el job `application` completo (que además corre `test:docs:pasos-manuales`, `test:db:guard-migraciones`, `estilos:check`, `test:estilos:sueltos`, `e2e:escritura:check`, `test:e2e:escritura`, `ui:empresas:check`, `test:ui:empresas`, `prototipo:check`, `test:prototipo:inventario`, `test:matriz:pantalla`, `pnpm lint` y el build) sólo se puede certificar en el CI: en el log del run 43482415728 todos esos pasos anteriores a `matriz:check` ya habían pasado, y el cambio es una fila de texto en una spec, sin efecto sobre ellos. **Certificado en el CI**: run `43491976550`, job `application` id `132131028268` → success.
- El job `quality` no bloquea el merge (`validacion` depende de `changes, application, web, infrastructure, database`, no de `quality`) y con esta rama pasa: `knip` da 0 hallazgos porque el `knip.json` de `dokploy` ya declara el tooling de evidencia E2E que trae de `main` (commit `d345eeb1`). El `gh pr checks 934` del run `43547159355` lo dejó en `pass` (1m6s).
- El job `application` completo (con la base ya actualizada) sólo se certifica en el CI: en local se corrieron los 14 pasos que no dependen de la base de datos ni del navegador, más `lint` y `build`. El resto (`web`, `database`, `e2e-tienda`) es del contenido que trae la integración y no lo modificó esta historia.
- El gate endurecido no comprueba que el «no aplica» traiga **motivo** (eso es prosa y lo revisa el Revisor): comprueba que la fila «Empresa activa» exista. Las 18 specs anteriores al Principio VIII quedan exceptuadas de ese requisito en `scripts/matriz-pantalla-empresa-exentas.txt`; si alguna se completa con la fila, su línea se borra de la lista.

## Recommendation

Cerrar el bug: verificado localmente con el gate real contra la base del PR y
confirmado en el CI (`application` y `validacion` en verde sobre el SHA del
arreglo). La rama quedó sincronizada con `dokploy` (merge `24d73b49`, re-sync
`858b85b1`, `352dc359` y `49b80e3f`), así que el PR #934 ya no está
`CONFLICTING` ni `DIRTY`. La devolución del Revisor quedó atendida: el
follow-up de `knip` se borró (describía un estado inexistente), el gate exige
la fila «Empresa activa» con su test de rechazo (que **falla** con el regex
viejo) y la lista de exentas para no romper los PRs de épica contra `main`, y
la evidencia de la fila «Estado del PR» es el estado real del comando.
