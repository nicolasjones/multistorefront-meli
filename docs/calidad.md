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
pnpm calidad --code          # sin docker (sin secretos/SAST)
pnpm calidad --only=secrets,sast
node scripts/calidad.mjs --no-docker
```

Complementa (no reemplaza) el CI existente (`docs:check`, `estilos:check`, `prototipo:check`,
`matriz:check`, `lint`, `build`, `test:web`, `test:db`).

## Qué corre

| Check | Herramienta | Qué detecta |
|---|---|---|
| Secretos | **gitleaks** (docker) | claves/tokens commiteados (con allowlist de ejemplos/tests) |
| SAST | **semgrep** (docker, reglas `p/secrets`, `p/typescript`, `p/react`) | patrones inseguros, XSS, secretos en código |
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
saber la causa. `scripts/calidad.mjs` lo evita con dos garantías, y las dos están fijadas por
test (`pnpm test:ci` → `scripts/calidad.test.mjs`). A eso se suma cómo hay que leer el informe:

1. **El informe dice qué encontró el check que falló.** `reports/calidad.md` lleva una sección
   `## <check>` por cada check con hallazgos, con su salida; `reports/calidad.log` lleva la
   salida completa de todas las herramientas. El artifact `calidad-reporte` sube los dos.
2. **Las herramientas no heredan `GITHUB_ACTIONS`.** Con esa variable, knip y oxlint cambian a
   su modo de anotaciones (`::warning`/`::error`): el runner las consume como anotaciones y el
   texto del hallazgo desaparece del log, así que el rojo queda sin diagnóstico. `calidad.mjs`
   la borra del entorno de los hijos y los corre con `NO_COLOR`/`FORCE_COLOR` apagados.
3. **La copia versionada de `reports/calidad.md` es una foto de una corrida vieja.** El job
   `quality` regenera el informe en el workspace y lo sube como artifact `calidad-reporte`; lo que
   quedó versionado es la última corrida local que alguien commiteó, y por convención no se
   commitea una regenerada (el diff no lleva reporte generado). Esa copia puede marcar
   `hallazgos` de un problema que ya no existe: en MSF-843 seguía diciendo
   `knip (código muerto) | hallazgos` cuando knip ya daba 0, y eso fue lo que apuntó al hallazgo
   inexistente. El estado que vale es el del artifact del CI o el de `pnpm calidad` en el momento;
   para el código, `pnpm dlx knip@6.44.1 --no-progress`.

Esto es lo que pasó en MSF-843: el `quality` del PR #882 quedó rojo con un knip que en el log
sólo aparecía como `apps/web/src/pages/conexiones/list.tsx:44:1`, sin el texto que explicaba el
hallazgo. El hallazgo real era otro (una dependencia `pg` sin declarar en
`apps/web/e2e/ventas-impresion.e2e.ts:88:130`) y no se pudo leer sin correr la herramienta.

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
