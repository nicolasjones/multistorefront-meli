# Bug Fix: Rendimiento móvil del catálogo y la ficha medido y registrado (MSF-552 · T071/SC-010 de MSF-167)

- **Slug**: msf-552
- **Fixed**: 2026-11-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El criterio de cierre SC-010 («medición de rendimiento en celular del catálogo y la ficha, anotada en
`docs/tiendas-online.md`») estaba cerrado como cumplido sin cifras. Con la medición repetible que ya está en la
rama (script `pnpm medir:tienda` + job `medir` del nightly), se corrió la medición de verdad sobre el stack con
el seed y se registraron **las cifras reales** en `docs/tiendas-online.md` («Rendimiento en celular»), con su
entorno y su fuente, más el ajuste que corresponde: **D3 (24) no se ajusta** y la consulta por precio cumple
(215 ms con 500 productos visibles); lo que no cumple es el **LCP móvil** (17,4–18,5 s contra el objetivo de 3 s),
por una causa que no es de la base: la tienda pública carga el *bundle* del panel.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `docs/tiendas-online.md` | modified | Sección «Rendimiento en celular (T071, SC-010)»: se reemplaza «No medido todavía» por las cuatro rutas medidas (LCP/FCP/CLS/TBT), el costo de `publico.catalogo_pagina_por_dominio` con 500 productos, el veredicto, el ajuste de D3 y la fuente (run + artifact). En las re-verificaciones del 20 y 21/11/2026 cuatro cifras que la guía daba como generales se corrigieron por lo que sale del artifact (ver «Re-verificación» en `test.md`). **Segunda vuelta (revisión QA y de seguridad)**: el contrato del job `medir` (falla si no se midió, si no llega al objetivo o si supera la línea base), la línea base declarada (22.000 ms), el modelo de costo de D3 y el «Costo y techo esperado» quedan alineados con lo que el script hace |
| `docs/tecnico/tienda-catalogo-y-ficha.md` | modified | «Límites y deuda»: la deuda «Rendimiento móvil no medido» pasa a «medido y NO cumple el objetivo», con las cifras y el enlace a la guía |
| `docs/profundidad.md` | modified | **Segunda vuelta**: el contrato del job `medir` (falla si no se midió, si no llega al objetivo o si supera la línea base) |
| `docs/tienda-movil.md` | modified | Tabla de LCP: catálogo y ficha con los valores medidos (MSF-552); la home sigue pendiente (MSF-560, que mide otra pantalla) |
| `scripts/medir-tienda-lighthouse.mjs` | modified | **Segunda vuelta**: una ruta sin reporte cuenta como «sin medir» (antes una medición parcial se publicaba como exitosa y el job salía con 0); el job **falla** cuando el LCP no llega al objetivo (antes sólo fallaba por regresión, con el nightly verde con el LCP 6× arriba del objetivo); `--salida` se propaga a `upload.outputDir` de LHCI (antes la opción CLI era inservible); el cuerpo crudo de la respuesta de la RPC se recorta en el log |
| `scripts/verificar-medicion-tienda.mjs` | modified | **Segunda vuelta**: la guarda comprueba las **cuatro rutas distintas** (host + path) en vez de contar filas (una fila repetida pasaba la guarda) y exige que la sección declare la línea base del job |
| `scripts/sembrar-tienda-medicion.sql` | modified | **Segunda vuelta**: el `%%` del `RAISE` (que abortaba con «too many parameters specified for RAISE» y nunca mostraba el mensaje de la guarda) pasa a `%`; la cantidad de productos se valida como entero sin interpolar texto crudo; el uso documentado exige `ON_ERROR_STOP=1` y `--single-transaction` (sin ellos, psql seguía tras el error de la guarda y sembraba en una base que no era del seed) |
| `scripts/medir-tienda-catalogo.sql` | modified | **Segunda vuelta**: guarda de entorno (se niega a medir en una base que no sea del seed) y validación de la cantidad de productos |
| `scripts/limpiar-tienda-medicion.sql` | modified | **Segunda vuelta**: guarda de entorno antes de borrar y borrado acotado a las dos tiendas del seed |
| `scripts/*.test.mjs` (4 archivos) | modified | **Segunda vuelta**: tests de las reglas nuevas (ruta sin reporte, objetivo que no se cumple, línea base de la guía contra la del script, rutas repetidas, guarda de entorno, `:N` sin interpolar cruda) |
| `.github/workflows/nightly.yml` | modified | **Segunda vuelta**: el input `productos` se valida con una expresión regular antes de llegar al `psql` (se sustituye textualmente: era inyección SQL en la base del CI); la CLI de Supabase se verifica con el SHA256 publicado del release antes de extraerla; el `psql` de la siembra y el de la RPC llevan `ON_ERROR_STOP=1` (la siembra, además, `--single-transaction`) |
| `package.json` | modified | **Segunda vuelta**: `test:medir:tienda` entra en `pnpm test` y en `test:ci:scripts` (los tests de la medición no corrían en ningún workflow: cambiar el perfil de Lighthouse o romper la siembra no fallaba nada) |
| `.specify/bugs/msf-552/fix.md` | added | Este informe |
| `.specify/bugs/msf-552/test.md` | added | Informe de verificación |

La primera corrida no cambió código: la medición repetible (`.lighthouserc.tienda.json`,
`scripts/medir-tienda-lighthouse.mjs`, `scripts/medir-tienda-catalogo.sql`, `scripts/sembrar-tienda-medicion.sql`,
`scripts/verificar-medicion-tienda.mjs` y el job `medir` de `.github/workflows/nightly.yml`) ya está en la rama
(commits `30b5d21cc`…`65f1c7337`) y es lo que produjo las cifras que aquí se registran.

La **segunda vuelta** (ésta) corrige lo que señalando la revisión de QA y la de seguridad sobre esa medición:
las reglas que el job y las guardas decian no eran las que el código cumplía, y tres scripts SQL no tenían la
guarda de entorno que sus equivalents ya tenían. No cambian las cifras registradas: cambian quién decide que
una medición está incompleta y qué pasa si la guarda de entorno no se cumple.

## Diff Highlights (optional)

La sección de la guía pasa de un protocolo en prosa a las cifras:

```
| Pantalla | URL | Corridas | LCP (mediana) | FCP | CLS | TBT | Perf. | A11y |
| Mundo JC · catálogo | http://mundojc.localhost:4312/catalogo | 3 | 18.511 ms | 16.911 ms | 0,627 | 1.173 ms | 14 | 100 |
```

## Tests Added or Updated

La primera corrida no agregó tests: la guarda que exige que la sección lleve cifras
(`scripts/verificar-medicion-tienda.mjs`, en `pnpm docs:check`) y sus tests ya existían en la rama.

En la **segunda vuelta** los tests se ajustan a las reglas nuevas (la suite `pnpm test:medir:tienda` pasa de
27 a 42 tests):

| Test | Qué vigila |
|---|---|
| «una ruta sin reporte NO se midió» (Lighthouse) | Que una medición parcial no se publique como exitosa: la ruta sin reporte queda en `sinMedir` y el job falla |
| «no cumplir el objetivo hace fallar la medición» (Lighthouse) | Que el job no quede verde con el LCP 6× arriba del objetivo, y que la regresión (por encima de la línea base) se distinga |
| «el LCP de una ruta se mide aunque el reporte venga con otra forma de la URL» | Que el match de host + path no dependa de la forma exacta de la URL |
| «los reportes se leen del directorio que pide `--salida`» | Que la opción CLI no sea inservible (LHCI escribe donde el script lee) |
| «la guía declara la misma línea base que el script» | Que la guía y el script no se contradigan sobre el número |
| «falla si falta una ruta y otra está repetida» (guarda) | Que la guarda cuente rutas distintas y no filas |
| «falla si no declara la línea base del job `medir`» (guarda) | Que la guía declare la línea base |
| «el mensaje de la guarda de entorno se muestra» (siembra) | Que el `RAISE` tenga un `%` por argumento (con `%%` aborta con «too many parameters») |
| «el uso documentado aborta si la guarda falla» (siembra) | Que `ON_ERROR_STOP=1` y `--single-transaction` no se saquen del uso |
| «la cantidad de productos se valida» (siembra y RPC) | Que `:N` no se interpole crudo en el SQL (psql sustituye textualmente) |
| «se niega a medir en una base que no es del seed» (RPC) y «no borra en una base que no es del seed» (limpieza) | Que los dos scripts tengan la guarda de entorno |

## Local Verification

- `node scripts/verificar-medicion-tienda.mjs` → «Medición de rendimiento de la tienda: OK (cifras con entorno y
  fuente).»
- `pnpm test:medir:tienda` → verde (guarda documental, perfil de Lighthouse, script SQL y siembra).
- `pnpm docs:check` → verde.
- `pnpm lint` → 0 errores; `pnpm build` → compila.
- **Segunda vuelta (21/11/2026)**: `pnpm test:medir:tienda` → 42/42; `pnpm docs:check` → verde; `pnpm lint` → 0
  errores; `pnpm build` → compila; `pnpm workflows:check` → verde. Cada regla nueva se comprobó **cambiando el
  código a propósito** (el `%%` de la guarda, el `motivoDeFallo` que deja de fallar sin cumplir el objetivo, las
  filas que se arman sólo desde los reportes, la línea base del script que se aparta de la de la guía y la guarda
  que vuelve a contar filas): en los cinco casos algún test falló, y se revirtieron los cambios. La medición en
  vivo tampoco se pudo repetir (sin demonio de Docker): la repite el job `medir` del nightly.
- **La medición NO se pudo correr en este entorno**: no hay acceso al demonio de Docker
  (`permission denied while trying to connect to the Docker daemon socket`), así que no hay stack local de
  Supabase con el seed. Las cifras de esta corrida salen del **CI**: run del nightly `44118543460` (job `medir`,
  17/11/2026), artifact `medir-tienda` (`reports/lighthouse-tienda/resumen.md` y
  `reports/medir-tienda/rpc-catalogo.txt`). Se reprodujo además la causa con un build local del front
  (`vite build`): el *entry* `index-*.js` contiene los textos del panel («Organizaciones», «Reparaciones»,
  «Ventas») y no los de la tienda («Todos los productos», «Solo con stock»), lo que confirma que la tienda
  pública descarga el bundle del panel. El peso del *entry* que figura en la guía (911 KB sin comprimir) es el
  que midió el CI; el front cambió después (merge con `dokploy`) y el build local de hoy da 948,88 kB.
- **Re-verificación del 20/11/2026**: se bajó el artifact y se contrastó cada cifra con los 12 reportes de
  Lighthouse. Tres estaban anotadas como generales cuando eran de una sola corrida (el primer byte, el «element
  render delay» y el tiempo de descarga del *entry*): se corrigieron por los rangos que salen del artifact. Ver
  «Re-verificación» en `test.md`.
- **Re-verificación del 21/11/2026**: se volvió a contrastar la guía con el mismo artifact. Una cuarta
  generalización («la primera carga pide 126 scripts») era del catálogo y no de la ficha (132): se corrigió en
  la guía y en las dos guías que repiten la cifra.

## Deviations from Assessment

- La evaluación medía el catálogo y la ficha sobre **el seed**; el paso 3 del protocolo («medir la RPC con un
  catálogo de cientos de productos») no lo puede hacer el seed, porque `supabase/seed.sql` no crea filas en
  `dominio.producto_empresa` (el catálogo sale vacío). Se resolvió con dos mediciones, tal como proponía la
  alternativa de la propia evaluación: (a) Lighthouse sobre las **dos tiendas del seed** con 500 productos
  sembrados por `scripts/sembrar-tienda-medicion.sql`, y (b) el costo de la RPC sobre una tienda sintética de
  500 productos (`med.ejemplo.com`) que el script revierte.
- La evaluación pedía medir en el job `e2e-tienda` de `validate.yml` **o** en el `nightly`. Se eligió el
  `nightly`: el job `e2e-tienda` es bloqueante del PR y agregar Lighthouse ahí gasta minutos de runner en cada
  push; además el `nightly` ya instala `@lhci/cli`. El job nuevo es `medir`, con kill switch (`CI_MEDIR_TIENDA`)
  y sin tocar `.lighthouserc.json` (que mide el panel con un `assert` de `error`).
- Las **preguntas abiertas** de la evaluación no bloquean: la medición es sobre el seed (la alternativa
  «demo con 2.204 productos» queda para MSF-560, que mide sobre la demo) y el cierre de T071 en
  `tasks.md`/`tasks/CIERRE.md` lo escribe el runner (esta corrida no edita `tasks.md`).

## Revisión QA y de seguridad (segunda vuelta)

Los hallazgos accionables de la devolución se atendieron uno por uno:

| Hallazgo | Qué se cambió |
|---|---|
| `sembrar-tienda-medicion.sql`: `%%` en el `RAISE` (0 placeholders con 1 argumento ⇒ «too many parameters specified for RAISE») y psql que seguía tras el error | `%%` → `%` (el mensaje de la guarda ahora se ve) y el uso documentado (y el del CI) exige `ON_ERROR_STOP=1` y `--single-transaction`: si la guarda falla, no se siembra nada |
| `medir-tienda-lighthouse.mjs`: `sinMedir` sólo veía las rutas con reporte sin auditoría de LCP; una ruta sin reporte no aparecía y el job salía con 0 | Las filas se arman desde las **rutas esperadas**: la que no tiene reporte queda sin LCP, cuenta como «sin medir» y el job sale con 1 |
| `medir-tienda-lighthouse.mjs`: el job sólo fallaba por regresión (22.000 ms) y el nightly quedaba verde con el LCP 6× arriba del objetivo | El job **falla** si alguna ruta no se midió, si el LCP no llega al objetivo (3.000 ms) o si supera la línea base. La línea base (22.000 ms) queda declarada en la guía y un test compara los dos números |
| `package.json`: `test:medir:tienda` no estaba en `pnpm test` ni en ningún workflow | Entra en `pnpm test` y en `test:ci:scripts` (que corre el job `chequeos` del CI) |
| `verificar-medicion-tienda.mjs`: la guarda contaba filas, no rutas (una guía con 3 rutas y una fila repetida pasaba) | La guarda reconoce cada ruta por host + path y exige las cuatro; además exige que la sección declare la línea base |
| `.lighthouserc.tienda.json`: `upload.outputDir` fijo y `--salida` sin propagar (la opción CLI era inservible) | El script sobrescribe `upload.outputDir` con el directorio de `--salida` |
| Guías: el contrato del job y el modelo de costo no eran los implementados | `docs/tiendas-online.md` («Rendimiento en celular», «Costo y techo esperado» y el párrafo de D3), `docs/profundidad.md` y `docs/tecnico/tienda-catalogo-y-ficha.md` alineados con el código |
| Seguridad: el input `productos` del `workflow_dispatch` llegaba crudo al `psql -v N` (inyección SQL en la base del CI) | Se valida con `^[0-9]{1,6}$` (y rango 1–10.000) en un paso propio; además los tres scripts SQL validan la cantidad como entero sin interpolar texto crudo |
| Seguridad: la CLI de Supabase se descargaba del release sin verificar | Se verifica el SHA256 publicado del release antes de extraerla (el digest está en el workflow, revisable) |
| Seguridad: `medir-tienda-catalogo.sql` y `limpiar-tienda-medicion.sql` sin guarda de entorno | Los dos se niegan a correr (y a borrar) en una base con organizaciones que no son del seed; el borrado queda acotado a las dos tiendas del seed |
| Seguridad (informativo): el log de error de la RPC volcaba el cuerpo crudo de la respuesta | Se recorta a 200 caracteres |

## Follow-ups

- **Deuda nueva que deja la medición (no es de T071):** la tienda pública carga el *bundle* del panel, y por eso
  el LCP móvil es de ~18 s y el CLS del catálogo llega a 0,63. La corrección (que la tienda pública no cargue el
  panel: *entry* propio o carga diferida de `App`) es un cambio de front y **necesita su propia spec**; queda
  anotada en `docs/tiendas-online.md` («Deuda que deja esta medición»), en `docs/tienda-movil.md` y en
  `docs/tecnico/tienda-catalogo-y-ficha.md`. Dueño propuesto: Frontend. Tarea `seguimiento` a dar de alta por el
  orquestador (desde el nodo de ejecución no hay acceso al tracker).
- **El job `medir` del nightly queda en rojo** mientras el LCP no llegue al objetivo: es intencional (el script
  sale con código 1 si alguna ruta no se midió, si el LCP no llega al objetivo o si supera la línea base, para
  que la regresión se vea en el run y no se esconda en el resumen). Con el arreglo de arriba vuelve a verde.
- **MSF-560** mide lo mismo sobre la demo (con el catálogo real de 2.204 productos por tienda). Si sus valores
  difieren, la diferencia es el entorno, no el objetivo; queda anotado en `docs/tienda-movil.md`.
