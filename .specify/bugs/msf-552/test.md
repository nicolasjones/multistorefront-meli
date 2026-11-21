# Bug Verification: Rendimiento móvil del catálogo y la ficha medido y registrado (MSF-552 · T071/SC-010 de MSF-167)

- **Slug**: msf-552
- **Tested**: 2026-11-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma era documental: el criterio SC-010 estaba cerrado como cumplido sin cifras y la guía decía «No medido
todavía». Ahora la guía tiene las cuatro rutas medidas con su entorno y su fuente, el costo de la RPC con 500
productos y el ajuste de D3. La medición no se pudo repetir en este entorno (sin Docker): las cifras vienen del
run del CI `44118543460`, hecho sobre el **mismo commit** de la rama (`65f1c7337`) y con el código de medición
que hoy está en el repo; se descargó el artifact y se leyeron los reportes de Lighthouse y los `NOTICE` de la
RPC. La causa del LCP alto se reprodujo además con un build local del front.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node scripts/verificar-medicion-tienda.mjs` | pass | La guarda que exige cifras con entorno y fuente pasa: «Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).» |
| La guarda detecta la regresión | `git stash push -- docs/tiendas-online.md` + la misma guarda | pass (detecta) | Con la sección sin cifras la guarda sale con código 1 y enumera los cuatro requisitos que faltan: no se puede volver a cerrar el criterio «sin medir» |
| New / updated tests | `pnpm test:medir:tienda` | pass | 27 tests, 0 fallos (perfil móvil de Lighthouse, cuatro rutas medidas, mediana y veredicto, script SQL con `ROLLBACK`, siembra idempotente y la guarda documental) |
| Medición de verdad (en CI) | run `44118543460`, job `medir` (17/11/2026) | pass | Stack local de Supabase con el seed + 500 productos por tienda; 4 rutas × 3 corridas de Lighthouse en perfil móvil; artifact `medir-tienda` con `resumen.md`, `resumen.json`, los 12 reportes de Lighthouse y `rpc-catalogo.txt`. El job sale con código 1 porque el LCP no llega al objetivo (comportamiento esperado) |
| Las cifras del artifact | lectura de `resumen.json` y de los 12 reportes de Lighthouse | pass | LCP 17.378–18.511 ms (medianas por ruta); «element render delay» 16,6–21,6 s; «time to first byte» del recurso que pinta el LCP 11–67 ms; 126 scripts en el catálogo y 132 en la ficha (1.986 KB sin comprimir / 675 KB comprimidos en el catálogo; 2.011 KB / 688 KB en la ficha) en la primera carga; el *entry* tarda ~2,9 s en descargarse (738 ms → 3.603 s) y el FCP llega a los 16,9 s; CLS 0,627 (catálogo de Mundo JC) |
| Causa del LCP (build local) | `VITE_PANEL_HOSTS=localhost,127.0.0.1 pnpm --filter @platform/web exec vite build` | pass | El *entry* `index-*.js` trae los textos del panel («Organizaciones», «Reparaciones», «Ventas») y no los de la tienda («Todos los productos», «Solo con stock»): la tienda pública carga el bundle del panel. El peso de 911 KB que figura en la guía es el del artifact del CI |
| Regression suite (docs) | `pnpm docs:check` | pass | Documentación de cambios OK, migraciones OK (0 nuevas), trampas conocidas OK y la guarda de la medición OK |
| Regression suite (front) | `pnpm lint` | pass | 0 errores (309 warnings preexistentes en archivos que este cambio no toca) |
| Build | `pnpm build` | pass | Compila (el warning de «chunks > 500 kB» es el del *entry* de 932 KB, que es justamente la causa medida del LCP) |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack: ok. **gitleaks no se pudo correr** (necesita Docker): el informe lo marca como hallazgo, pero es la falta de acceso al demonio, no un secreto |
| pgTAP / pruebas de base | `pnpm test:db` | not-run | Sin acceso al demonio de Docker no hay Postgres local. Esta historia **no cambia el esquema ni las RPC**: solo documentación y el informe del bug |

## Re-verificación (2026-11-20)

Se bajó otra vez el artifact `medir-tienda` del run `44118543460` y se contrastó **cada cifra** de la guía con
los 12 reportes de Lighthouse y con los `NOTICE` de la RPC: coinciden las medianas por ruta, el desglose del
LCP, los pesos en bytes, los culpables del CLS y los milisegundos de la RPC. El contraste destapó tres
cifras que la guía daba como generales y eran de **una sola corrida**:

- «el primer byte llega en 67 ms» → el servidor responde en menos de 50 ms en las 12 corridas y el «time to first
  byte» del recurso que pinta el LCP va de 11 a 67 ms.
- «el LCP tarda 18,4 s en pintarse» → el «element render delay» va de 16,6 s a 21,6 s.
- «ese bundle tarda ~16 s en llegar y evaluarse» → el *entry* tarda ~2,9 s en descargarse (738 ms → 3.603 s) y el
  FCP llega a los 16,9 s: el cuello de botella es ejecutar el JavaScript con la CPU ×4, no la red.

Las tres quedaron corregidas en `docs/tiendas-online.md` (y en las dos guías que repiten la misma cifra) con los
rangos que salen del artifact. Gates de esta corrida: `pnpm lint` (0 errores), `pnpm build` (ok),
`pnpm test:medir:tienda` (27/27) y `pnpm docs:check` (ok). La medición en vivo no se pudo repetir (sin demonio
de Docker): las cifras siguen viniendo del run del CI.

## Re-verificación (2026-11-21)

Se volvió a contrastar la guía con los 12 reportes de Lighthouse del artifact `medir-tienda` (run `44118543460`).
Siguen coincidiendo las medianas por ruta, el desglose del LCP, los pesos en bytes, los culpables del CLS y los
milisegundos de la RPC. El contraste destapó una cuarta generalización que la guía daba por válida en las 12
carridas y solo valía en 6:

- «la primera carga pide 126 scripts (1.986 KB sin comprimir, 675 KB comprimidos)» → en el **catálogo** son 126
  scripts (1.986 KB sin comprimir / 675 KB comprimidos) y en la **ficha** 132 (2.011 KB / 688 KB). La guía y las
  dos guías que repiten la cifra ahora distinguen las dos rutas.

Y un matiz sobre el peso del *entry*: los 911 KB sin comprimir que cita la guía son los que midió el CI (el
`resourceSize` del artifact). El front cambió después (merge con `dokploy`) y el build local de hoy da 948,88 kB:
lo reproducible es la **composición** del *entry* (los textos del panel están, los de la tienda no), no su peso.

## Segunda vuelta: revisión QA y de seguridad (2026-11-21)

La devolución del Revisor señalaba que las reglas que el job y las guardas decian no eran las que el código
cumplía. Esta corrida las alinea y las cubre con tests. **No cambia ninguna cifra registrada**: el LCP sigue
sin llegar al objetivo y el veredicto sigue siendo «NO cumple».

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Suite de la medición | `pnpm test:medir:tienda` | pass | 42 tests, 0 fallos (antes 27): rutas sin reporte, objetivo que no se cumple, línea base de la guía contra la del script, `--salida`, rutas repetidas, guardas de entorno y `:N` sin interpolar crudo |
| La suite corre en el CI | `pnpm test:ci:scripts` incluye `test:medir:tienda` | pass | Antes los tests de la medición no corrían en ningún workflow: cambiar el perfil de Lighthouse o romper la siembra no fallaba nada |
| Reglas que vigilan (mutación) | se cambió el código a propósito y se comprobó que algún test falla | pass | Cinco mutaciones, cinco detecciones: `%%` en el `RAISE` de la guarda; el `motivoDeFallo` que deja de fallar sin cumplir el objetivo; las filas que se arman sólo desde los reportes (vuelve el «sin medir» incompleto); la línea base del script apartada de la de la guía; la guarda que vuelve a contar filas en vez de rutas. Las cinco se revirtieron |
| Guarda documental | `node scripts/verificar-medicion-tienda.mjs` | pass | «Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).» Ahora además exige las cuatro rutas **distintas** y la línea base declarada |
| Contrato del job | `pnpm test:medir:tienda` + lectura de `scripts/medir-tienda-lighthouse.mjs` | pass | El job sale con 1 si alguna ruta no se midió, si el LCP no llega al objetivo (3.000 ms) o si supera la línea base (22.000 ms). Antes salía con 0 con el LCP 6× arriba del objetivo |
| Documentación | `pnpm docs:check` | pass | Cambian `docs/tiendas-online.md`, `docs/profundidad.md` y `docs/tecnico/tienda-catalogo-y-ficha.md`: el contrato del job, el modelo de costo de D3 y el «Costo y techo esperado» |
| Workflows | `pnpm workflows:check` | pass | Acciones pineadas por SHA y `timeout-minutes` en todos los jobs |
| Validación del input | `[[ "$PRODUCTOS" =~ ^[0-9]{1,6}$ ]]` (probado con 500, 0, 10.000, 10.001, «5; drop», «abc» y vacío) | pass | Sólo pasan los enteros del rango; el input del `workflow_dispatch` ya no llega crudo al `psql -v N` |
| Lint y build | `pnpm lint` y `pnpm build` | pass | 0 errores; compila |
| Medición en vivo | job `medir` del nightly | not-run | Sin demonio de Docker en este entorno: no hay stack local con el seed. La repite el nightly (y ahora el job falla si el objetivo no se cumple, que es lo que debe pasar) |
| pgTAP / pruebas de base | `pnpm test:db` | not-run | Sin demonio de Docker no hay Postgres local. Esta historia no cambia el esquema ni las RPC |

## Output Excerpts

```
$ node scripts/verificar-medicion-tienda.mjs
Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).

$ pnpm test:medir:tienda
ℹ tests 42 · ℹ pass 42 · ℹ fail 0

$ pnpm docs:check
Documentación de cambios: OK (3945 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 748 archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 0 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).
```

Del artifact del CI (run `44118543460`):

```
| Pantalla | Corridas | LCP | FCP | CLS | TBT | Perf. | A11y |
| Mundo JC · catálogo | 3 | 18511 ms | 16911 ms | 0.627 | 1173 ms | 14 | 100 |
| Mundo JC · ficha   | 3 | 17783 ms | 16662 ms | 0.105 |  631 ms | 38 | 100 |
| San Javucho · catálogo | 3 | 18206 ms | 16443 ms | 0.229 | 873 ms | 23 | 100 |
| San Javucho · ficha   | 3 | 17378 ms | 16757 ms | 0.105 | 481 ms | 42 | 100 |
Objetivo: LCP ≤ 3000 ms. LCP máximo medido: 18511 ms. Veredicto: NO cumple.

NOTICE:  catalogo relevancia  -> mediana 39 ms  · corridas {60,37,40,39,36}  · productos en la pagina 24 · total 500
NOTICE:  catalogo precio_asc -> mediana 215 ms · corridas {202,199,234,215,228} · productos en la pagina 24 · total 500
NOTICE:  catalogo precio_desc-> mediana 205 ms · corridas {218,191,205,205,186} · productos en la pagina 24 · total 500
NOTICE:  catalogo precio_max -> mediana 192 ms · corridas {206,182,192,179,236} · productos en la pagina 24 · total 200
NOTICE:  catalogo solo_stock -> mediana 49 ms  · corridas {73,65,49,39,38}     · productos en la pagina 24 · total 250
```

## Residual Risks

- **La medición no es local**: sale del CI (runner self-hosted con el stack de Supabase y el seed). Es
  reproducible con `pnpm medir:tienda` contra un stack con el seed, pero los números dependen del entorno: con
  otro hardware o con otro catálogo los valores cambian. Por eso la guía registra el entorno y el artifact, y
  por eso el objetivo se evalúa con la mediana de 3 corridas y no con una sola.
- **Es una estimación de órdenes de magnitud, no un SLA**: la RPC se midió en local, sin red ni concurrencia
  (mismo criterio que `scripts/medir-tienda-favoritos.sql`).
- **La home no está medida**: T071 cubre catálogo y ficha. La home la mide MSF-560 sobre la demo; queda
  anotado en `docs/tienda-movil.md`.
- **El objetivo de LCP no se cumple** y eso no es un fallo de esta historia: es el resultado que T071 debía
  registrar. Queda como deuda con dueño (front) y necesita su propia spec.
- **El job `medir` del nightly queda en rojo** mientras el LCP no llegue al objetivo: es intencional (el script
  sale con código 1 si alguna ruta no se midió, si el LCP no llega al objetivo o si supera la línea base, para
  que la regresión se vea en el run).

## Recommendation

Cerrar el bug — verificado: el criterio SC-010 tiene cifras reales, con entorno y fuente, la guarda
documental impide que vuelva a cerrarse «sin medir», y el ajuste de D3 queda anotado (no hay que ajustarlo: el
costo de la RPC no depende del tamaño de página). La deuda que dejó la medición (la tienda pública carga el
bundle del panel) queda trazada con dueño y necesita su propia spec; no es parte de MSF-552.
