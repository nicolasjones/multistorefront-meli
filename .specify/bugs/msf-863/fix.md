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

- No se agregó ningún test: la regla ya está cubierta por `scripts/verificar-matriz-pantalla.test.mjs` («acepta «no aplica» con motivo» y «acepta la fila de empresa activa»), que no depende del contenido de la spec 023.
- La verificación de esta historia es el propio gate (`pnpm matriz:check`), que se ejecutó contra la base real del PR (`origin/dokploy`) antes y después del arreglo.

## Local Verification

- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (antes del arreglo) → exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa» … - specs/023-visor-componentes/spec.md` (mismo mensaje que el CI, run 43482415728).
- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (después del arreglo) → exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).`
- `pnpm test:matriz:pantalla` → 10/10 en verde.
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
| `pnpm calidad` | oxlint / jscpd / dependency-cruiser / syncpack **ok**; gitleaks sin Docker en este entorno; knip con 6 hallazgos **preexistentes de `main`** (ver Follow-ups) |


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

Ninguna. La fila se agregó dentro de la sección `## Matriz pantalla↔criterios` y con las dos columnas de la tabla existente.

## Follow-ups

- El job `quality` (knip) del PR #929 sigue en rojo por el tooling de evidencia E2E que trae de `main` sin actualizar la configuración de knip; no bloquea el merge (no está en el `needs` de `validacion`, decisión MSF-683/PR #737) y queda fuera del alcance de esta historia. Los 6 hallazgos (1 archivo sin usar, 1 dependencia y 4 binarios sin listar) apuntan a `docs/javascripts/zoom-imagenes.js`, `scripts/armar-video-evidencia.mjs` y `scripts/publicar-videos-e2e.mjs`, que existen en `origin/main` y **no** en `origin/dokploy`: los trae el propio merge main→dokploy del PR #929, no este cambio. Ajustar `knip.json` acá además divergería del PR #929, así que no se tocó.
- `.opencode/commands/speckit.agent-context.update.md` (y el resto de `.specify/extensions/agent-context/*`) **no** se revierten: son contenido de `main` que el PR #929 trae a `dokploy` (commit `962debf1`, `chore(integracion): traer main a dokploy antes del Release`). Revertirlos en esta rama abriría un diff de reversión contra la integración que se mergearía después; no son un cambio de esta historia.
- El gate `scripts/verificar-matriz-pantalla.mjs:21` busca sólo la palabra «empresa» (`/empresa/i`) en el cuerpo de la matriz, aunque su mensaje exige «Empresa activa» con su motivo: una matriz que mencione «empresa» de otra forma pasa el gate. Viene de `main` (no lo introduce este PR) y el tracker acotó esta historia a la fila de la spec 023, así que no se toca el gate: queda anotado para corregirlo en `main`.
