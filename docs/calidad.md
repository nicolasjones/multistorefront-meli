---
owner: tecnico
sources:
  - scripts/calidad.mjs
  - .github/workflows/quality.yml
  - .gitleaks.toml
  - .jscpd.json
  - .dependency-cruiser.cjs
  - knip.json
  - apps/web/vite.config.ts
---

# Calidad determinista (F1)

Checks que **no dependen del criterio** de una persona/agente. El objetivo es doble:

1. **Menos ida y vuelta dev↔revisor**: el Desarrollador corre `pnpm calidad` **antes** de pedir review.
2. **Evidencia para el Revisor**: los hallazgos son citables (no prosa).

## Uso

```bash
pnpm calidad                 # todo
pnpm calidad:code            # = node scripts/calidad.mjs --no-docker (sin Docker: gitleaks solo si hay binario nativo)
pnpm calidad --only=secrets,sast
node scripts/calidad.mjs --no-docker
```

Complementa (no reemplaza) el CI existente (`docs:check`, `estilos:check`, `prototipo:check`,
`matriz:check`, `lint`, `build`, `test:web`, `test:db`).

## Qué corre

| Check | Herramienta | Qué detecta |
|---|---|---|
| Secretos | **gitleaks** (binario nativo; Docker solo como alternativa local, `.gitleaks.toml`) | claves/tokens commiteados (con allowlist de ejemplos/tests y exclusión de `.pnpm-store/` y `node_modules/`) |
| SAST | **oxlint** con reglas de seguridad (`no-eval`, `no-new-func`, `no-implied-eval`, `no-script-url`) sobre `apps`, `packages` y `supabase/functions`; no usa Docker ni PyPI | patrones inseguros (`eval`, `new Function`, `javascript:`) |
| Código muerto | **knip** | archivos/exports/deps sin usar |
| Duplicación | **jscpd** (`.jscpd.json`) | bloques copiados |
| Arquitectura | **dependency-cruiser** (`.dependency-cruiser.cjs`), binario local del root | ciclos, huérfanos, deps de dev en runtime |
| Versiones | **syncpack** | versiones divergentes entre workspaces |
| Mensajes | **commitlint** (sólo en PR, con rango) | commits en formato conventional (evita mensajes basura; habilita release/changelog); se exceptúan los merge commits (incluido `Merge base de la épica en <rama>`, MSF-804) y los commits del runner de historias (`MSF-123: F-XXX-01 · título`, formato exacto del runner) |

Si una herramienta no está disponible, el check se **saltea** con aviso (no rompe). La excepción es el
check de **arquitectura**: `dependency-cruiser` es una `devDependency` del root, así que si falta el binario
local (`pnpm install` sin correr) el check **falla** — sin él no se revisó nada y el «ok» sería falso.

## Arquitectura: qué revisa de verdad

Hasta MSF-895 el check corría la herramienta en el sandbox de `pnpm dlx`, que no encuentra el compilador de
TypeScript: la herramienta descartaba los `.ts/.tsx` y devolvía «0 módulos, 0 dependencias» — un **verde
falso** sobre `apps/web/src` (`no-circular`, `no-orphans` y `not-to-dev-dep` nunca se evaluaron). Ahora:

- corre el **binario local** (`node_modules/.bin/depcruise`, con `dependency-cruiser` y `typescript` como
  `devDependencies` del root) y cruza el front de verdad: **1674 módulos y 6220 dependencias** (medición del
  2026-11-22; el guard dice las suyas en la salida, no son un número fijo);
- **falla** si no cruzó ningún módulo, y también si falta el binario local;
- los **tests forman parte del cruce**: si se excluyeran, los archivos de apoyo que sólo importan los tests
  quedarían sin ninguna arista y `no-orphans` los marcaría como código muerto (falso positivo);
- `node_modules` **no** va en `exclude`: excluirlo borra la arista hacia el paquete y con ella la
  clasificación `npm`/`npm-dev`. Con `doNotFollow` el paquete no se cruza, pero la arista queda y las
  reglas que lo necesitan (`not-to-dev-dep`) sí pueden dispararse.

Al habilitarlo aparecieron los hallazgos que nadie veía: **3 ciclos de imports** (`fuenteTienda.tsx` ↔
`tiendaInicio.ts` y `configuracion/index.tsx` ↔ sus dos pestañas), corregidos en MSF-895 moviendo los tipos
compartidos a módulos propios, y **1 dependencia de desarrollo usada en runtime**:
`apps/web/src/lib/importacion-productos.ts` importaba `fflate` (declarado como `devDependency`) para
descomprimir los ZIP importados. `fflate` pasó a `dependencies` del front porque se usa en runtime, no sólo
en las pruebas. La regla `not-to-dev-dep` excluye los tests y sus archivos de apoyo (`*.test.*` y
`apps/web/src/test/`), que sí pueden usar `devDependencies` (`vitest`, `axe-core`, ...).

## Estado

- El job `quality` **falla** (rojo) ante hallazgos, pero **no bloquea el merge**: el ruleset de GitHub
  (25358575) exige solo `validacion`. No existe `continue-on-error` en el workflow. Para volverlo
  bloqueante hay que agregar `quality` a los checks requeridos del ruleset (acción de administración).
- `pnpm calidad` termina en su bloque `---- RESUMEN ----`.
  Si una herramienta se cae, queda como `hallazgos` con la causa.
  Un check con hallazgos imprime su salida completa en el log del CI y en `reports/calidad.md`.
  La salida completa de cada herramienta va a `reports/calidad.log`.
  Los dos archivos se suben como artifact `calidad-reporte`, se generan en cada corrida y no se versionan (MSF-843).
  Los registros históricos de `specs/` y `.specify/bugs/` citan un `reports/calidad.md` versionado.
  Desde MSF-843 ese archivo se genera con `pnpm calidad` (`scripts/calidad.mjs`) y se sube como artifact `calidad-reporte` del job `quality`.
- Baseline medido (2026-10-18, `origin/main`): gitleaks **22 hallazgos, todos ejemplos/placeholders**
  (0 reales); jscpd **0,44%**; knip **1** (`useFeatureHabilitada`); sin ciclos.
- Revisión 2026-11-22 (MSF-895): con el guard de arquitectura **de verdad** activo sobre `apps/web/src`
  (1674 módulos, 6220 dependencias) aparecieron **3 ciclos de imports** que nadie veía y **1 `devDependency`
  usada en runtime** (`fflate`); los 4 se corrigieron en el mismo lote y el guard cierra en verde.
- Revisión 2026-11-15 (seguimiento de los hallazgos menores de la revisión semanal): `knip` ya no marca
  exports ni tipos exportados sin uso en `apps/web/src` (antes: ~35 y 6; lotes anteriores los limpiaron), así
  que no hubo nada que quitar. `oxlint` 1.79.0 sobre `apps/web/src` pasó de 287 a 286 warnings: se quitó el
  único `no-unused-vars` (parámetro de `catch` sin uso). Quedan sin tocar 205 `set-state-in-effect`, 39 `refs`
  y 16 `exhaustive-deps`: reinician formularios o recargan datos al abrir diálogos o cambiar de empresa, y
  quitar el efecto o una dependencia cambia el comportamiento de la pantalla.

## Tests web: timeouts

`apps/web/vite.config.ts` fija `testTimeout: 15000` (el default de vitest es 5 s). La suite
completa tarda ~30 min y corre en runners compartidos con los agentes: con 5 s, un test
lento falla por timeout aunque la lógica esté bien (MSF-189: `CuentaCobroDialog`, 874/875
tests OK, 1 timeout). 15 s sigue acotando un cuelgue real, pero evita el falso rojo que
obligaba a re-ejecutar el shard completo. Si un test necesita más, se le pasa el timeout
explícito en el propio test.

El `testTimeout` de vitest no gobierna las esperas de Testing Library: `findBy*` y `waitFor`
tienen su propio límite (1000 ms por defecto) y expiran antes que el test. Cuando el elemento
aparece recién después de una consulta —el detalle de la reparación, por ejemplo, primero pide
la reparación y después el comprobante asociado— hay que pasarle el margen en la espera:
`await screen.findByRole('button', { name: 'Generar comprobante' }, { timeout: 5000 })`. Con el
límite por defecto, el shard daba rojo intermitente en el runner self-hosted (MSF-232).

## Roadmap del programa
F1 (esto) · F2 fitness functions + observabilidad (Grafana/Prometheus) · F3 errores/backups/secretos ·
F4 release/preview/flags · F5 mutation/a11y/perf.

> MSF-687: `knip`, `jscpd` y `@commitlint/cli` corren con `pnpm dlx` a versión fija en `scripts/calidad.mjs`; al subirlas, cambiar ahí la versión. `dependency-cruiser` ya no usa `pnpm dlx` (MSF-895): corre el binario local del root y su versión se sube en `package.json` (`devDependencies`).

> `knip.json` declara a propósito lo que knip no puede inferir de los scripts de evidencia de E2E y del sitio de docs que
> vinieron de `main` en la integración (PR #929): `docs/javascripts/zoom-imagenes.js` lo carga MkDocs por `extra_javascript`
> (no por un `import`); `@playwright/test` lo importa `scripts/armar-video-evidencia.mjs` desde el workspace web; y
> `ffmpeg`, `tailscale`, `hostname` y `pkill` son herramientas del sistema que usan `scripts/armar-video-evidencia.mjs` y
> `scripts/publicar-videos-e2e.mjs`. `hostname` (`hostname -I`) y `pkill` (`pkill -f 'http.server …'`) los llama `scripts/publicar-videos-e2e.mjs` dentro de
> un `execSync`; knip los cuenta como binarios sin declarar si se quitan de `ignoreBinaries` (se probó: siguen siendo necesarios).
> `knip.json` es JSON estricto (sin comentarios), por eso el motivo se documenta acá. Un script nuevo que dependa de un binario del sistema lo suma a `ignoreBinaries`.

> Lote 99 (MSF-703/704): los workflows eligen su pool de runners por variable de repo (`CI_RUNS_ON_PR`, `CI_RUNS_ON_PESADO`, `CI_RUNS_ON_DEPLOY`), los binarios descargados (gitleaks, Supabase CLI) se instalan en `$RUNNER_TEMP/bin` con SHA256 verificado y release-please y el gate de staging abren un issue `alerta-ci` si fallan. Detalle y runbook: [endurecimiento-infra.md](endurecimiento-infra.md).
