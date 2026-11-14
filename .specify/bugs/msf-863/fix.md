# Bug Fix: fila «Empresa activa» en la matriz de la spec 023 (CI `application` rojo)

- **Slug**: msf-863
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se completó la matriz `## Matriz pantalla↔criterios` de `specs/023-visor-componentes/spec.md` con la fila «Empresa activa», declarada como **no aplica** con su motivo: el visor de componentes es una pantalla interna de desarrollo que sólo lee el manifiesto de cobertura E2E, sin datos de empresa. Con eso el gate `pnpm matriz:check` del job `application` deja de fallar y el PR #929 puede mergearse a `dokploy`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `specs/023-visor-componentes/spec.md` | modified | Una fila nueva en `## Matriz pantalla↔criterios`: «Fila **Empresa activa**» con el motivo del «no aplica» |
| `scripts/verificar-matriz-pantalla.mjs` | modified | El gate exige la **fila** «Empresa activa», no la palabra «empresa» |
| `scripts/verificar-matriz-pantalla.test.mjs` | test | Test de rechazo (matriz que sólo menciona «empresa») y tests de la exención |
| `scripts/matriz-pantalla-empresa-exentas.txt` | added | Specs con UI anteriores al Principio VIII: se exceptúan sólo de la fila «Empresa activa» |
| `docs/prototipos.md` | modified | Documenta la regla endurecida y la lista de exentas |
| `.specify/bugs/msf-863/assessment.md` | added | Evaluación del bug (síntoma, reproducción, causa, remediación) |
| `.specify/bugs/msf-863/fix.md` | added | Este informe |
| `.specify/bugs/msf-863/test.md` | added | Verificación del arreglo |

No se tocó código, migraciones, workflows ni el resto del merge de #929.

## Diff Highlights

```diff
 | Bloque "Ítems sin E2E" | FR-002 (progreso) |
 | Vacío con instrucciones | FR-005, US3 |
+| Fila **Empresa activa** | **No aplica** (FR-005): MSF ya no expone el visor (`/cobertura-e2e` se quitó en la spec 026 y vive en el panel SDLC) y, cuando existió, su única fuente era el manifiesto de cobertura E2E (`cobertura-e2e.json`): nunca leyó ni escribió datos de empresa ni mostró selector, columna o texto de empresa, así que no hay empresa activa que respetar ni consultas que recargar al cambiarla (Principio VIII) |
```

### Corrección de la revisión (segunda vuelta)

La primera versión de la fila tenía **tres celdas** en una tabla de **dos**
columnas (`| Elemento visible | Criterio |`): al renderizar, Markdown descarta
la celda sobrante y el criterio `FR-005 (fuente de datos)` se perdía. La fila
ahora tiene dos celdas, como las demás de la tabla, y el criterio va dentro
del texto de la columna «Criterio» (mismo patrón de las specs de 2 columnas,
p. ej. `specs/20261028-100000-service-seguimiento-y-reportes/spec.md:358`).

De paso se corrigió el motivo, que describía un estado que ya no existe: la
spec 026 (`specs/026-e2e-en-panel-sdlc/spec.md:18`, FR-001) quitó la ruta
`/cobertura-e2e`, sus páginas y la subida al bucket, y el visor pasó al panel
SDLC. La fila lo dice, sin cambiar el alcance de la spec 023.

### Tercera vuelta: sincronizar la rama con `dokploy` (PR #934 `CONFLICTING`)

El arreglo del paso anterior quedó en `d85b8e40`, pero `dokploy` avanzó 3
commits (`4f1d3c30` → `d57c9ebc`, PR #936) y la rama quedó **behind**:
`gh pr view 934` reportaba `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`.
Sin ese sync el PR #934 no se podía mergear y `validacion` quedaba en rojo.

Se mergeó `origin/dokploy` sobre la rama (commit `24d73b49`, `Merge
remote-tracking branch 'origin/dokploy' into fix/bug-MSF-863`). El único
conflicto fue `docs/solicitar-acceso.md` (la página de `dokploy` reescribió el
documento como guía de producto y la rama traía la nota de SMTP/587-STARTTLS de
`main`): se resolvió con el **mismo contenido que ya está en la rama de
integración** (`origin/integracion/main-en-dokploy`, commit `34cd63a2`), de modo
que el árbol de esta rama y el del PR #929 quedan **idénticos**
(`git diff 34cd63a2 HEAD` → vacío) y ninguno de los dos PRs diverge del otro.

Migraciones: la del PR (`20270307110000_evidencias_e2e`) sigue siendo la
mayor de `supabase/migrations/` — por encima de
`20270307100000_service_role_grants_tablas_public_e2e` (PR #923) — así que el
guard de migraciones no lo bloquea.

## Tests Added or Updated

- `scripts/verificar-matriz-pantalla.test.mjs` — se agregan cuatro pruebas:
  - «rechaza una matriz que sólo menciona «empresa» sin declarar la empresa
    activa» (el test de rechazo que faltaba: con el regex viejo falla);
  - «exime a las specs anteriores al Principio VIII de exigir la fila de
    empresa activa»;
  - «lee la lista de specs exentas de empresa ignorando comentarios» y «la
    lista de exentas de empresa apunta a specs que existen» (la lista no se
    pudre).
- Las pruebas que ya existían («pide la empresa activa en la matriz», «acepta
  «no aplica» con motivo», «acepta la fila de empresa activa») siguen en verde:
  la fila de la spec 023 no depende del contenido de la spec 023.
- La verificación de esta historia es el propio gate (`pnpm matriz:check`), que
  se ejecutó contra la base real del PR (`origin/dokploy`) antes y después del
  arreglo.

## Local Verification

- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (antes del arreglo) → exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa» … - specs/023-visor-componentes/spec.md` (mismo mensaje que el CI, run 43482415728).
- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (después del arreglo) → exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).`
- `pnpm test:matriz:pantalla` → 10/10 en verde (en esa vuelta; tras la quinta vuelta son 14/14).
- `GITHUB_BASE_REF=dokploy pnpm docs:check` → `Documentación de cambios: OK (599 archivos comparados contra origin/dokploy).` · `Migraciones OK: 644 archivo(s), 1 nuevo(s) contra origin/dokploy.`
- `pnpm prototipo:check` → `Inventario del prototipo: OK (120 pantallas al día).`
- `pnpm lint` → exit 0 (sólo warnings de oxlint preexistentes del PR).
- `pnpm build` → `✓ built`.
- Comprobación de la tabla de la matriz (2 columnas): la fila «Empresa activa»
  tiene 2 celdas, igual que el encabezado; antes tenía 3.

### Verificación de la tercera vuelta (sync con `dokploy`)

Todos los pasos del job `application` que no dependen de la base de datos,
corridos en local contra el árbol mergeado (`24d73b49`):

| Paso | Resultado |
|---|---|
| `pnpm docs:check` · `test:docs:pasos-manuales` · `test:db:guard-migraciones` | OK |
| `pnpm estilos:check` · `test:estilos:sueltos` | OK |
| `pnpm e2e:escritura:check` · `test:e2e:escritura` · `test:e2e:omitidos` | OK |
| `pnpm ui:empresas:check` · `test:ui:empresas` | OK |
| `pnpm prototipo:check` · `test:prototipo:inventario` | OK |
| `pnpm matriz:check` · `test:matriz:pantalla` | OK (10/10) |
| `pnpm lint` | exit 0 (warnings preexistentes) |
| `pnpm build` | `✓ built` |
| `pnpm test:edge:enviar-aviso-faltante` (lo que trae el merge de `dokploy`) | 126/126 |
| `pnpm calidad` | oxlint / jscpd / dependency-cruiser / syncpack **ok**; gitleaks sin Docker en este entorno; knip con 6 hallazgos **en esa vuelta** (los resolvió `d345eeb1` en `dokploy`; ver quinta vuelta) |

### Cuarta vuelta: re-sync con `dokploy` (`fbd3d565`)

`dokploy` volvió a avanzar (43 commits, hasta `fbd3d565`, con el PR #929 ya
mergeado) y el PR #934 volvió a quedar `CONFLICTING` / `DIRTY`. Se mergeó
`origin/dokploy` sobre la rama sin conflictos (commit `858b85b1`, `Merge
remote-tracking branch 'origin/dokploy' into fix/bug-MSF-863`). Tras el merge,
la rama sólo difiere de `origin/dokploy` en estos dos informes: la fila
«Empresa activa» de la spec 023 ya está en `dokploy` por el PR #929, así que no
se duplica ni se re-toca la spec. No se crean migraciones.

Verificado en local contra `origin/dokploy` (`fbd3d565`):

| Paso | Resultado |
|---|---|
| `GITHUB_BASE_REF=dokploy pnpm matriz:check` | OK (0 specs nuevas revisadas) |
| `GITHUB_BASE_REF=dokploy pnpm docs:check` | OK · `Migraciones OK: 649 archivo(s), 0 nuevo(s)` |
| `pnpm prototipo:check` | OK (120 pantallas al día) |
| `pnpm test:matriz:pantalla` | 10/10 |
| `pnpm estilos:check` · `pnpm lint` | OK (warnings preexistentes) |

Estado del PR tras el push (`858b85b1`): `mergeable: MERGEABLE`,
`mergeStateStatus: BLOCKED` (ya no `CONFLICTING`/`DIRTY`); `BLOCKED` sólo por el
check requerido `validacion` mientras corre en el runner self-hosted. El job
`quality` pasó (1m22s).

### Quinta vuelta: devolución del Revisor (PR #934, SHA `f5d48cc9`)

El Revisor pidió cambios sobre tres puntos de este informe (no sobre el código de
la fila de la spec 023, que ya está en `dokploy` por el PR #929). Se atendieron
los tres:

**1. El follow-up de `knip` describía un estado que no existe (severidad Media).**
Decía que los 6 hallazgos de `knip` «existen en `origin/main` y **no** en
`origin/dokploy`» y que `quality` «sigue en rojo». Es falso, y el propio informe
se contradecía más arriba («Estado del PR tras el push (`858b85b1`)»: «El job
`quality` pasó (1m22s)»). Verificado:

| Qué se afirmaba | Qué es cierto | Evidencia |
|---|---|---|
| Los 3 archivos «no existen» en `origin/dokploy` | Los 3 existen en `origin/dokploy` | `git cat-file -e origin/dokploy:<archivo>` → 3/3 existen (`docs/javascripts/zoom-imagenes.js`, `scripts/armar-video-evidencia.mjs`, `scripts/publicar-videos-e2e.mjs`) |
| `knip.json` no declara esos 6 | `knip.json` **ya** los declara | `knip.json` lista `docs/javascripts/zoom-imagenes.js` (ignore), `@playwright/test` (ignoreDependencies) y los binarios `ffmpeg`, `hostname`, `pkill`, `tailscale`: commit `d345eeb1` («chore(calidad): declarar en knip lo que traen los scripts de main»), que es ancestro de `origin/dokploy` (`git merge-base --is-ancestor d345eeb1 origin/dokploy` → 0) |
| `quality` «sigue en rojo» | `quality` **pasó** | `gh pr checks 934` → `quality pass 1m6s` (run `43547159355`) y `pnpm calidad` local → `knip (código muerto): ok`, 0 hallazgos |

Con eso el follow-up se borró: no hay nada que seguir ni que planificar sobre un
estado inexistente.

**2. El gate no exigía la fila «Empresa activa» (severidad Media).**
`scripts/verificar-matriz-pantalla.mjs` matcheaba `/empresa/i` (línea 21): una
spec nueva con UI cuya matriz mencionara «empresa» en cualquier frase pasaba
el gate, aunque su mensaje y la constitución (Principio VIII) exigen la **fila**
«Empresa activa». El follow-up lo derivaba a `main` sin dueño (requisito
huérfano). Ahora se corrige acá:

- El gate matchea `/empresa\s+activa/i`: tiene que estar la fila, no la palabra.
- Se agrega el **test de rechazo**: una matriz que sólo menciona «empresa»
  («La pantalla filtra por la empresa de la barra superior») es rechazada. Con el
  regex viejo ese test **falla** (`motivoSpecSinEmpresa` devolvía `null`), así
  que vigila la regla.
- Las specs con UI escritas **antes** del Principio VIII (constitución 1.9.0),
  cuya matriz mapea lo visible pero nunca declaró esa fila, se exceptúan en
  `scripts/matriz-pantalla-empresa-exentas.txt` (18 specs, todas ya mergeadas
  en `dokploy`). Es el mismo criterio de deuda explícita que usa
  `scripts/matriz-pantalla-exentas.txt` para la matriz, y evita romper los 14
  PRs de épica abiertos contra `main`, que vuelven a sumar esas specs y que el
  gate estricto rechazaba (10 de ellas por PR): verificado en un worktree
  temporal con `origin/epic/MSF-140-inicio-rentabilidad-y-reportes-reportes-`
  → con el regex estricto exit 1 y 10 specs listadas; con la lista de exentas
  exit 0 («47 specs nuevas revisadas»).
- El requisito de «Empresa activa: no aplica» **con su motivo** no se automatiza
  (es prosa): lo revisa el Revisor. El gate sólo verifica que la fila exista.

**3. La fila «Estado del PR» de `test.md:32` (severidad Baja).** Decía `pass`
con evidencia «ver el run del CI en vivo», que no es una evidencia: se cambió
por el estado real del comando (`gh pr view 934 --json mergeable,mergeStateStatus`
→ `MERGEABLE` / `BLOCKED`), con la evidencia real en la fila siguiente.

Verificado en local:

| Paso | Resultado |
|---|---|
| `pnpm test:matriz:pantalla` | 14/14 (antes 10/10: +4 pruebas) |
| Test de rechazo con el regex viejo (`/empresa/i`) | **falla** (`motivoSpecSinEmpresa` devolvió `null`): el test vigila la regla |
| `GITHUB_BASE_REF=dokploy pnpm matriz:check` | OK (0 specs nuevas revisadas) |
| Gate contra `origin/main` con el epic MSF-140 (worktree temporal) | exit 1 con 10 specs **antes** de la lista de exentas; exit 0 («47 specs nuevas revisadas») después |
| Gate contra `origin/main` con una spec nueva de prueba | exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa»…` (sin la fila) / exit 0 (con la fila) |
| `pnpm calidad` | oxlint / knip / jscpd / dependency-cruiser / syncpack **ok**; gitleaks sin Docker en este entorno («permission denied … /var/run/docker.sock») |
| `pnpm lint` · `pnpm build` | exit 0 · `✓ built` |
| `GITHUB_BASE_REF=dokploy pnpm docs:check` | OK (documentación de cambios + migraciones) |
| `pnpm prototipo:check` | OK (120 pantallas al día) |

## CI

- Run `43491976550` (rama `integracion/main-en-dokploy`, PR #929, SHA
  `73de5501`), job `application` id `132131028268` → **success**: el paso
  `pnpm matriz:check` pasó contra `origin/dokploy`.
- Run `43492109016` (rama `fix/bug-MSF-863`, PR #934, mismo SHA) → `validacion`
  **success**.
- Run `43501005142` (rama `fix/bug-MSF-863`, SHA `d85b8e40`) → job `application`
  **success** (20:50Z): el gate `pnpm matriz:check` pasó con la base nueva; el
  PR, en cambio, seguía `CONFLICTING` por el atraso de la base, que es lo que
  resuelve el merge `24d73b49`.

## Deviations from Assessment

- La fila se agregó dentro de la sección `## Matriz pantalla↔criterios` y con las dos columnas de la tabla existente.
- En la quinta vuelta se tocó `scripts/verificar-matriz-pantalla.mjs`, que el
  assessment marcaba como «no se toca: es la regla nueva de `main`». La razón
  es que el Revisor pidió el regex corregido **con su test de rechazo en esta
  historia** (o, en su defecto, un seguimiento con dueño): derivarlo a `main`
  sin dueño dejaba el requisito huérfano. El cambio se limita a exigir la fila
  «Empresa activa» y a exceptuar de ese requisito a las specs anteriores al
  Principio VIII (18, todas ya mergeadas), para no romper los PRs de épica
  abiertos contra `main`.

## Follow-ups

- `.opencode/commands/speckit.agent-context.update.md` (y el resto de `.specify/extensions/agent-context/*`) **no** se revierten: son contenido de `main` que el PR #929 trae a `dokploy` (commit `962debf1`, `chore(integracion): traer main a dokploy antes del Release`). Revertirlos en esta rama abriría un diff de reversión contra la integración que se mergearía después; no son un cambio de esta historia.
- Sin otros seguimientos: el `knip` de los PR de integración está declarado en `knip.json` desde `d345eeb1` y el job `quality` pasa; el gate de la matriz quedó corregido en esta historia (con su test de rechazo), así que no queda ningún requisito derivado a `main` sin dueño.
