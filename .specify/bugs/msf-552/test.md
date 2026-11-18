# Bug Verification: Rendimiento móvil del catálogo y la ficha medido y registrado (MSF-552 · T071/SC-010 de MSF-167)

- **Slug**: msf-552
- **Tested**: 2026-11-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma era documental: el criterio SC-010 estaba cerrado como cumplido sin cifras y la guía decía «No medido
todavía». Ahora la guía tiene las cuatro rutas medidas con su entorno y su fuente, el costo de la RPC con 500
productos y el ajuste de D3. La medición no se pudo repetir en este entorno (sin Docker): las cifras comes del
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
| Las cifras del artifact | lectura de `resumen.json` y de los reportes de Lighthouse | pass | LCP 17.378–18.511 ms; TTFB 67 ms; «element render delay» 18.444 ms; 126 scripts y 673 KB comprimidos en la primera carga; CLS 0,627 (catálogo de Mundo JC) |
| Causa del LCP (build local) | `VITE_PANEL_HOSTS=localhost,127.0.0.1 pnpm --filter @platform/web exec vite build` | pass | El *entry* `index-*.js` pesa 911 KB sin comprimir y trae los textos del panel («Organizaciones», «Reparaciones», «Ventas») y no los de la tienda («Todos los productos», «Solo con stock»): la tienda pública carga el bundle del panel |
| Regression suite (docs) | `pnpm docs:check` | pass | Documentación de cambios OK, migraciones OK (0 nuevas), trampas conocidas OK y la guarda de la medición OK |
| Regression suite (front) | `pnpm lint` | pass | 0 errores (309 warnings preexistentes en archivos que este cambio no toca) |
| Build | `pnpm build` | pass | Compila (el warning de «chunks > 500 kB» es el del *entry* de 932 KB, que es justamente la causa medida del LCP) |
| Calidad determinista | `pnpm calidad` | partial | oxlint, knip, jscpd, dependency-cruiser y syncpack: ok. **gitleaks no se pudo correr** (necesita Docker): el informe lo marca como hallazgo, pero es la falta de acceso al demonio, no un secreto |
| pgTAP / pruebas de base | `pnpm test:db` | not-run | Sin acceso al demonio de Docker no hay Postgres local. Esta historia **no cambia el esquema ni las RPC**: solo documentación y el informe del bug |

## Output Excerpts

```
$ node scripts/verificar-medicion-tienda.mjs
Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).

$ pnpm test:medir:tienda
ℹ tests 27 · ℹ pass 27 · ℹ fail 0

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
  sale con código 1 si alguna ruta lo supera, para que la regresión se vea en el run).

## Recommendation

Cerrar el bug — verificado: el criterio SC-010 tiene cifras reales, con entorno y fuente, la guarda
documental impide que vuelva a cerrarse «sin medir», y el ajuste de D3 queda anotado (no hay que ajustarlo: el
costo de la RPC no depende del tamaño de página). La deuda que dejó la medición (la tienda pública carga el
bundle del panel) queda trazada con dueño y necesita su propia spec; no es parte de MSF-552.
