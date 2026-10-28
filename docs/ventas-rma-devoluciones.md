# Ventas · Devoluciones (RMA)

Guía de la épica MSF-178 (spec `specs/20261027-100000-ventas-rma-devoluciones`). Esta versión cubre **F-VTA-28 · Alta de RMA por ítem** (MSF-288) y **F-VTA-29 · Formas de resolución y seguimiento** (MSF-304); el vínculo con la nota de crédito y el stock (F-VTA-30) y el cierre de la épica la completan.

## Qué hay

- **Pantalla** `/ventas/devoluciones` («Devoluciones (RMA)», grupo Ventas, sección `ventas`): listado paginado (8 por página) con las columnas RMA, Tienda, Comprobante, Cliente, Producto, Forma de RMA, Motivo / operador y Estado; filtro Tienda (`FiltroEmpresa`, sigue a la empresa activa) y botón **Nueva devolución** (solo con `ventas` en edición). Prototipo: `design/pantallas/VentasDevoluciones.dc.html`.
- **Diálogo «Nueva devolución»**: Comprobante (solo facturas no borrador ni anuladas), Ítem, Cantidad, Forma de RMA (cinco opciones con descripción), Motivo y Observaciones. La **Cantidad** no está dibujada en el prototipo pero la base la exige (tope por línea). Si se cambia de tienda con el diálogo abierto, se cierra con aviso y no se guarda nada.
- **Catálogos del frontend** (`apps/web/src/lib/formasRma.ts`, `estadoRma.ts`): las cinco formas (`cambio_directo`, `enviado_a_proveedor`, `faltante_envio`, `reclamo_faltante`, `devolucion_importe`) y los tres estados (`abierto` «Abierta», `en_gestion` «En gestión», `cerrado` «Cerrada»). En la base son `check`, no tablas.

## Seguimiento (F-VTA-29)

- **Filtro «Forma de RMA»**: píldoras «Todas» + las cinco formas (`ToggleButtonGroup`), con recarga en el servidor (`p_forma_rma` de `listar_rma`), vuelta a la página 1 y el contador «N devoluciones». Con una forma sin registros: «Sin devoluciones · No hay registros con esa forma de RMA.». Al cambiar de empresa activa la pantalla se remonta y el filtro vuelve a «Todas».
- **Avance de estado** (no dibujado en el prototipo; requisito de la épica): quien tiene `ventas` en edición ve junto al chip de estado la acción **Pasar a En gestión** (Abierta) o **Cerrar** (En gestión); con la devolución Cerrada la acción queda deshabilitada. Éxito: «Devolución RMA-#### · {estado}»; error o conflicto: aviso en castellano. En ambos casos se vuelve a leer el listado.
- **Transición**: solo `abierto → en_gestion → cerrado`, sin saltos ni retrocesos (`22023`). Es idempotente (repetir el estado devuelve el actual, sin evento) y usa bloqueo optimista con `actualizado_en` (`40001` si otra persona la cambió). Evento `rma.estado_cambiado` («Pasó la devolución RMA-#### de Abierta a En gestión», con actor y tienda).

## Base de datos

| Objeto | Esquema | Notas |
|---|---|---|
| `dominio.rma` | `dominio` | Cabecera: organización, empresa, comprobante, `numero` `RMA-####`, forma, motivo, observaciones, estado, operador. |
| `dominio.rma_items` | `dominio` | Línea del comprobante, producto y cantidad. |
| `public.registrar_rma(comprobante, lineas, forma, motivo, observaciones)` | `public` | `security definer`. `ventas` en edición en la tienda del comprobante; factura confirmada no anulada; cantidad ≤ vendida − ya devuelta (comprobante tomado `for update`); número correlativo bajo lock de aviso; evento `rma.registrada`. |
| `public.listar_rma(busqueda, forma, estado, empresa, pagina, tamano)` | `public` | `security invoker`; delega en `private.listar_rma_sesion`, que deriva organización y tiendas del JWT. Orden: creación desc, número desc. Desde F-VTA-29 devuelve también `actualizado_en` (sello del bloqueo optimista). |
| `public.cambiar_estado_rma(id, estado, actualizado_en)` | `public` | `security definer`. `ventas` en edición en la tienda del RMA; transición lineal; idempotente; bloqueo optimista (`for update` + `actualizado_en`, renovado con `clock_timestamp()`); evento `rma.estado_cambiado`. Errores: `42501` permiso, `P0002` no existe, `22023` estado o transición inválidos, `40001` conflicto. |

Ambas tablas tienen RLS por organización y sección `ventas` (`select` con lectura o edición), **sin escritura directa** y `anon` sin privilegios. Las RPC llevan `revoke … from public, anon` y `grant execute … to authenticated`.

La cantidad ya devuelta se cuenta sobre los ítems de RMA anteriores de la misma línea. Una nota de crédito de «Devolución de productos» emitida aparte no se descuenta acá: el vínculo entre ambas es F-VTA-30.

## Pruebas

- pgTAP `supabase/tests/database/rma_alta.test.sql` (RLS, `check`, permisos, tope, numeración, listado, aislamiento).
- pgTAP `supabase/tests/database/rma_seguimiento.test.sql` (transición válida e inválida, idempotencia, bloqueo optimista, evento, permisos, aislamiento y `anon`; filtro `p_forma_rma`).
- Vitest `apps/web/src/pages/ventas/devoluciones.test.tsx` y `devoluciones.seguimiento.test.tsx` (filtro, contador, chips, avance de estado, teclado, cambio de empresa).
- E2E `apps/web/e2e/ventas-rma.e2e.ts` (rótulo `[MSF-288:T009]`, video de evidencia): factura confirmada → alta de la devolución → número, ítem y listado. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público); ver `docs/e2e-app.md`.

## Reversión

Migraciones aditivas `20270113100000`, `20270113100100`, `20270113100200`, `20270113110000` (`drop function public.cambiar_estado_rma(uuid, text, timestamptz)`) y `20270113110100` (recrea `listar_rma` con `actualizado_en`; se vuelve a la definición de `20270113100200`); el camino de reversión está en el encabezado de cada una (`drop function`, `drop table dominio.rma_items`, `drop table dominio.rma`). El PR se revierte entero con `git revert -m 1`.
