# Bug Verification: el runner de evidencia deja de degradar en silencio los ítems sin descripción utilizable

- **Slug**: msf-907
- **Tested**: 2026-11-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (una descripción casi vacía degrada en silencio: evidencia sin criterios, ítem
agrupado por tarea en vez de por historia, ítem contado como «sólo base de datos» y reporte por
épica en cero) **no se reproduce**: con la regla compartida, el runner deriva +66 historias y
+640 ítems que antes no veía, y lo que sigue sin derivar **queda listado con su motivo**
(`items_sin_descripcion` en el manifiesto, columna propia en el reporte por épica, video
publicado «sin criterios»). Los tests de la historia se escribieron primero y **fallan contra
el código previo**; contra el código arreglado pasan, sin regresiones en los módulos tocados.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | tests nuevos contra `28ee63831` en un worktree aparte | fail | 3/11 `cobertura-e2e`, 4/10 `armar-video-evidencia`, 1/2 `publicar-videos-e2e` y 5/5 `e2e-cobertura-epicas` fallan: el manifiesto no publica `items_sin_descripcion`, el código de historia detrás de `[P]` no une el ítem y el reporte por épica sale `historias= 0 … base 0`. |
| Reproduction (post-fix) | `python3 scripts/e2e-cobertura-epicas.py --epicas MSF-136` | pass | Antes `historias=  0 hechas= 26 SIN E2E=  0 (base   0)`; ahora `historias=  4 hechas= 26 SIN E2E=  0 (base   0)  sin descr.=  0` (los 5 ítems sin historia de esa spec ya están hechos: son de cierre, así que no hay nada que escribirles). |
| Regla: la cola cuenta lo pendiente | test nuevo con un `[CIERRE]` ya hecho | pass | `test_un_item_ya_hecho_sin_descripcion_no_cuenta`: con el filtro de «pendiente» el reporte da `sin descr.=  4`; sin él (código previo de esta revisión) da `sin descr.=  5` y el test falla. |
| New / updated tests | `pnpm test:cobertura:e2e` | pass | 11/11. |
| New / updated tests | `pnpm test:historia:item` | pass | 5/5. |
| New / updated tests | `pnpm test:e2e:cobertura:epicas` | pass | 5/5 (`unittest`, salida `OK`). |
| New / updated tests | `pnpm test:armar-video:e2e` | pass | 10/10. |
| New / updated tests | `pnpm test:publicar-videos:e2e` | pass | 2/2. |
| Regression suite | `pnpm lint` | pass | exit 0 (los avisos de `set-state-in-effect` son preexistentes de `apps/web`, sin tocar). |
| Regression suite | `pnpm build` | pass | exit 0 (`✓ built in 2.63s`). |
| Regression suite | `pnpm docs:check` | pass | Documentación de cambios OK · Migraciones OK (771 archivos, 0 nuevos) · Trampas conocidas OK. |
| Regression suite | `pnpm calidad` | pass | oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack en verde. `gitleaks` no corrió: el sandbox no tiene acceso al socket de Docker (limitación del entorno, no del código). |
| Alcance de la regla sobre el repo | conteo con la regla nueva y con la regla vieja | pass | Encabezados de historia con código: 221 (la regla vieja derivaba 155). Ítems con historia: 1953 (la regla vieja veía 1313). Ítems sin descripción utilizable: 1549, todos «sin historia» (ninguno «sin texto»): antes pasaban como «sólo base de datos». De esos, **194 pendientes** (la cola que cuenta el reporte) y 1355 ya hechos (en su mayoría ítems de specs de plantilla o de cierre, que no llevan código de historia). |

## Output Excerpts

```
# con el código previo (28ee63831) — el runner degrada en silencio
✖ lee los dos formatos de encabezado de historia del repo
✖ reporta la ambigüedad cuando dos historias declaran el mismo código
✖ publica los ítems sin descripción utilizable y las historias ambiguas
  TypeError: Cannot read properties of undefined (reading 'map')
✖ un ítem con el código de historia detrás de [P] cuelga de su historia
✖ un ítem sin descripción muestra su id en vez de un subtítulo vacío
✖ un video sin criterios se publica marcado como tal

FAIL: test_el_reporte_cuenta_las_historias_del_working_tree
AssertionError: 'historias=  4' not found in 'MSF-999   spec-demo   historias=  0 hechas=  0 SIN E2E=  0 (base   0)'
```

```
# con el código arreglado
ℹ tests 11  ℹ pass 11  ℹ fail 0     # pnpm test:cobertura:e2e
ℹ tests  5  ℹ pass  5  ℹ fail 0     # pnpm test:historia:item
Ran 5 tests in 0.461s  OK            # pnpm test:e2e:cobertura:epicas
ℹ tests 10  ℹ pass 10  ℹ fail 0     # pnpm test:armar-video:e2e
ℹ tests  2  ℹ pass  2  ℹ fail 0     # pnpm test:publicar-videos:e2e
Documentación de cambios: OK · Migraciones OK · Trampas conocidas: OK
```

## Residual Risks

- **El relleno de los 13 ítems es externo al repo**: viven en It's a Plan. El arreglo los hace visibles (con el motivo), pero su texto sigue siendo trabajo de quien los creó; no se inventaron requisitos (fuera de alcance explícito del ítem).
- **Cambian las cifras del reporte por épica**: la primera corrida tras el arreglo muestra una línea de base distinta (el reporte working tree antes salía siempre en cero). Hay que rebaselinear «historias SIN E2E» y «sólo base de datos».
- **El panel SDLC (repo vecino) todavía no consume las claves nuevas** `items_sin_descripcion` y `historias_ambiguas`: son aditivas y el visor las ignora, así que la lista queda a la vista en el repositorio (manifiesto, página del run y reporte por épica), no en el panel.
- **`gitleaks` no se pudo correr** en este entorno (necesita Docker); queda para el CI.
- **La regla de un ítem es del repo, no del tracker**: el runner deriva del `tasks.md` del repo. Los ítems que el tracker mande con descripción pobre siguen necesitando el gate humano (completar la descripción o cerrarlos como duplicado).

## Recommendation

Cerrar el bug — verificado: el síntoma original no se reproduce, los tests nuevos fallaban contra
el código previo y pasan contra el arreglado, y no hay regresiones en lint, build, documentación
ni en los módulos de evidencia tocados. Queda como seguimiento el relleno de los 13 ítems en el
tracker (fuera del repo) y el aviso al dueño del panel SDLC sobre las dos claves aditivas.
