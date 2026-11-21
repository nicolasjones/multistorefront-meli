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
| `docs/tiendas-online.md` | modified | Sección «Rendimiento en celular (T071, SC-010)»: se reemplaza «No medido todavía» por las cuatro rutas medidas (LCP/FCP/CLS/TBT), el costo de `publico.catalogo_pagina_por_dominio` con 500 productos, el veredicto, el ajuste de D3 y la fuente (run + artifact). En las re-verificaciones del 20 y 21/11/2026 cuatro cifras que la guía daba como generales se corrigieron por lo que sale del artifact (ver «Re-verificación» en `test.md`) |
| `docs/tecnico/tienda-catalogo-y-ficha.md` | modified | «Límites y deuda»: la deuda «Rendimiento móvil no medido» pasa a «medido y NO cumple el objetivo», con las cifras y el enlace a la guía |
| `docs/tienda-movil.md` | modified | Tabla de LCP: catálogo y ficha con los valores medidos (MSF-552); la home sigue pendiente (MSF-560, que mide otra pantalla) |
| `.specify/bugs/msf-552/fix.md` | added | Este informe |
| `.specify/bugs/msf-552/test.md` | added | Informe de verificación |

Sin cambios de código en esta corrida: la medición repetible (`.lighthouserc.tienda.json`,
`scripts/medir-tienda-lighthouse.mjs`, `scripts/medir-tienda-catalogo.sql`, `scripts/sembrar-tienda-medicion.sql`,
`scripts/verificar-medicion-tienda.mjs` y el job `medir` de `.github/workflows/nightly.yml`) ya está en la rama
(commits `30b5d21cc`…`65f1c7337`) y es lo que produjo las cifras que aquí se registran.

## Diff Highlights (optional)

La sección de la guía pasa de un protocolo en prosa a las cifras:

```
| Pantalla | URL | Corridas | LCP (mediana) | FCP | CLS | TBT | Perf. | A11y |
| Mundo JC · catálogo | http://mundojc.localhost:4312/catalogo | 3 | 18.511 ms | 16.911 ms | 0,627 | 1.173 ms | 14 | 100 |
```

## Tests Added or Updated

No se agregaron tests nuevos en esta corrida: la guarda que exige que la sección lleve cifras
(`scripts/verificar-medicion-tienda.mjs`, en `pnpm docs:check`) y sus tests ya existen en la rama, y ahora pasan
con las cifras registradas. La corrida de `pnpm test:medir:tienda` cubre el perfil móvil, las cuatro rutas, la
mediana y el veredicto.

## Local Verification

- `node scripts/verificar-medicion-tienda.mjs` → «Medición de rendimiento de la tienda: OK (cifras con entorno y
  fuente).»
- `pnpm test:medir:tienda` → verde (guarda documental, perfil de Lighthouse, script SQL y siembra).
- `pnpm docs:check` → verde.
- `pnpm lint` → 0 errores; `pnpm build` → compila.
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

## Follow-ups

- **Deuda nueva que deja la medición (no es de T071):** la tienda pública carga el *bundle* del panel, y por eso
  el LCP móvil es de ~18 s y el CLS del catálogo llega a 0,63. La corrección (que la tienda pública no cargue el
  panel: *entry* propio o carga diferida de `App`) es un cambio de front y **necesita su propia spec**; queda
  anotada en `docs/tiendas-online.md` («Deuda que deja esta medición»), en `docs/tienda-movil.md` y en
  `docs/tecnico/tienda-catalogo-y-ficha.md`. Dueño propuesto: Frontend. Tarea `seguimiento` a dar de alta por el
  orquestador (desde el nodo de ejecución no hay acceso al tracker).
- **El job `medir` del nightly queda en rojo** mientras el LCP no llegue al objetivo: es intencional (el script
  sale con código 1 si alguna ruta lo supera, para que la regresión se vea en el run y no se esconda en el
  resumen). Con el arreglo de arriba vuelve a verde.
- **MSF-560** mide lo mismo sobre la demo (con el catálogo real de 2.204 productos por tienda). Si sus valores
  difieren, la diferencia es el entorno, no el objetivo; queda anotado en `docs/tienda-movil.md`.
