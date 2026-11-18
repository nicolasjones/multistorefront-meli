---
owner: tecnico
sources:
  - specs
---

# Calidad determinista (F1)

Checks que **no dependen del criterio** de una persona/agente. El objetivo es doble:

1. **Menos ida y vuelta dev↔revisor**: el Desarrollador corre `pnpm calidad` **antes** de pedir review.
2. **Evidencia para el Revisor**: los hallazgos son citables (no prosa).

## Uso

```bash
pnpm calidad                 # todo
pnpm calidad:code            # sin docker (gitleaks usa el binario nativo o se salta)
pnpm calidad --only=secrets,sast
node scripts/calidad.mjs --no-docker
```

Complementa (no reemplaza) el CI existente (`docs:check`, `estilos:check`, `prototipo:check`,
`matriz:check`, `lint`, `build`, `test:web`, `test:db`).

## Qué corre

| Check | Herramienta | Qué detecta |
|---|---|---|
| Secretos | **gitleaks** (binario nativo; docker sólo de respaldo) | claves/tokens commiteados (con allowlist de ejemplos/tests) |
| SAST | **oxlint** 1.79.0 (`-D no-eval -D no-new-func -D no-implied-eval -D no-script-url` sobre `apps`, `packages`, `supabase/functions`) | `eval`, `new Function`, URLs `script:` |
| Código muerto | **knip** | archivos/exports/deps sin usar |
| Duplicación | **jscpd** (`.jscpd.json`) | bloques copiados |
| Arquitectura | **dependency-cruiser** (`.dependency-cruiser.cjs`) | ciclos, huérfanos, deps de dev en runtime |
| Versiones | **syncpack** | versiones divergentes entre workspaces |
| Mensajes | **commitlint** (sólo en PR, con rango) | commits en formato conventional (evita mensajes basura; habilita release/changelog); se exceptúan los merge commits (incluido `Merge base de la épica en <rama>`, MSF-804) y los commits del runner de historias (`MSF-123: F-XXX-01 · título`, formato exacto del runner) |

Si una herramienta no está disponible, el check se **saltea** con aviso (no rompe).

## Estado

- El job `quality` **falla** (rojo) ante hallazgos, pero **no bloquea el merge**: el ruleset de GitHub
  (25358575) exige solo `validacion`. No existe `continue-on-error` en el workflow. Para volverlo
  bloqueante hay que agregar `quality` a los checks requeridos del ruleset (acción de administración).
- `pnpm calidad` siempre termina en su bloque `---- RESUMEN ----`; si una herramienta se cae, queda como
  `hallazgos` con la causa. La salida completa de cada una va a `reports/calidad.log` (artifact
  `calidad-reporte`, junto con `reports/calidad.md`).
- Baseline medido (2026-10-18, `origin/main`): gitleaks **22 hallazgos, todos ejemplos/placeholders**
  (0 reales); jscpd **0,44%**; knip **1** (`useFeatureHabilitada`); sin ciclos.
- Revisión 2026-11-15 (seguimiento de los hallazgos menores de la revisión semanal): `knip` ya no marca
  exports ni tipos exportados sin uso en `apps/web/src` (antes: ~35 y 6; lotes anteriores los limpiaron), así
  que no hubo nada que quitar. `oxlint` 1.79.0 sobre `apps/web/src` pasó de 287 a 286 warnings: se quitó el
  único `no-unused-vars` (parámetro de `catch` sin uso). Quedan sin tocar 205 `set-state-in-effect`, 39 `refs`
  y 16 `exhaustive-deps`: reinician formularios o recargan datos al abrir diálogos o cambiar de empresa, y
  quitar el efecto o una dependencia cambia el comportamiento de la pantalla.

## Un rojo de calidad tiene que poder diagnosticarse

Un `quality` rojo que no dice qué encontró obliga a reproducir la herramienta a mano para
saber la causa. `scripts/calidad.mjs` lo evita con tres garantías, y las tres están fijadas por
test (`pnpm test:ci` → `scripts/calidad.test.mjs`):

1. **El check que falló dice qué encontró, entero.** Su salida va completa en la consola del
   paso del CI, en la sección `## <check>` de `reports/calidad.md` y en `reports/calidad.log`
   (el artifact `calidad-reporte` sube los dos). Recortarla —a las últimas 40 líneas en la
   consola o a las últimas 60 en el informe— volvería a esconder el hallazgo, que es justo lo
   que se quiere evitar. Los checks que pasan no necesitan el detalle: se quedan con sus
   últimas 40 líneas.
2. **El script no pierde el final del log.** Sale con `process.exitCode = 1` y no con
   `process.exit(1)`: en Linux, `process.exit(1)` descarta la cola de `stdout` que no entra en
   el buffer del pipe (64 KiB), así que con suficiente salida el final del log —justo el bloque
   del check que falló y el `---- RESUMEN ----`— se pierde y el rojo vuelve a quedar mudo.
3. **La salida de las herramientas es texto, no anotaciones.** `GITHUB_ACTIONS` no explica por
   qué se perdía texto: knip 6.44.1 no lee esa variable (0 referencias en el paquete publicado;
   su reporter por defecto es `symbols` y el `github-actions` sólo se usa con `--reporter`), y
   oxlint 1.79.0 corre con `--format=default` forzado, que no cambia con el entorno. El formato
   `github` de oxlint sí escribe anotaciones `::warning` —el runner las consume como anotaciones y
   del log sólo queda la anotación renderizada (`##[warning]…`), no la salida de la herramienta—,
   y por eso `calidad.mjs` borra `GITHUB_ACTIONS` del entorno de los hijos: que ninguna
   herramienta pueda cambiar a ese formato por el entorno.

Y dónde está la verdad sobre el estado de los checks: en el artifact `calidad-reporte` de la
corrida o en el `pnpm calidad` del momento. El informe es un archivo **generado** y no se
versiona: una copia vieja en el repo puede marcar `hallazgos` de un problema que ya no existe.
Para el código, `pnpm dlx knip@6.44.1 --no-progress`.

### Qué pasó en MSF-843

El `quality` del PR #882 quedó rojo y el log no decía qué encontró. La causa no fue el formato
de las herramientas: fue que **la salida del check que falló no llegó ni al log del paso ni al
informe**. En el log del job (run `43324206071`, job `131552415859`) se leen `== gitleaks
(secretos): ok` y `== oxlint (SAST): ok`, y después ya vienen anotaciones `##[warning]` (el
runner renderiza así las líneas `::warning` que escriben las herramientas) y, al final, el
fallo: no están el encabezado `== knip (código muerto): hallazgos`, ni la salida de knip, ni el
bloque `---- RESUMEN ----`. El artifact `calidad-reporte` de esa corrida (334 bytes) sí tiene la
tabla de los siete checks —knip `hallazgos`— pero sin la salida del check que falló. O sea: el
script terminó de correr los siete checks (la tabla lo prueba) y su salida se perdió después.

La última línea del log (`##[warning]apps/web/src/pages/conexiones/list.tsx:44:1`) **no** era un
hallazgo de knip: ese archivo es idéntico en la base, en el head del CI y en la base actual, y su
línea 44 es el `useEffect` que dispara la carga (nunca una declaración exportada). El hallazgo
real de knip era otro —una dependencia `pg` sin declarar en
`apps/web/e2e/ventas-impresion.e2e.ts:88:130`— y no se pudo leer sin correr la herramienta.

> Lo que no se pudo reconstruir es el mecanismo por el que esa salida no llegó al log: el log de
> GitHub Actions no conserva lo que se perdió. El contrato de este script es que la salida del
> check que falló se imprima completa y que el proceso termine sin descartar la cola de `stdout`.

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

> MSF-687: `knip`, `jscpd`, `dependency-cruiser` y `@commitlint/cli` corren con `pnpm dlx` a versión fija en `scripts/calidad.mjs`; al subirlas, cambiar ahí la versión.

> `knip.json` declara a propósito lo que knip no puede inferir de los scripts de evidencia de E2E y del sitio de docs que
> vinieron de `main` en la integración (PR #929): `docs/javascripts/zoom-imagenes.js` lo carga MkDocs por `extra_javascript`
> (no por un `import`); `@playwright/test` lo importa `scripts/armar-video-evidencia.mjs` desde el workspace web; y
> `ffmpeg`, `tailscale`, `hostname` y `pkill` son herramientas del sistema que usan `scripts/armar-video-evidencia.mjs` y
> `scripts/publicar-videos-e2e.mjs`. Un script nuevo que dependa de un binario del sistema lo suma a `ignoreBinaries`.
