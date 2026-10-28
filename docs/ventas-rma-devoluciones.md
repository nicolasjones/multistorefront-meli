# Ventas · Devoluciones (RMA)

Guía de la épica MSF-178 (spec `specs/20261027-100000-ventas-rma-devoluciones`). Esta versión cubre **F-VTA-28 · Alta de RMA por ítem** (MSF-288); el seguimiento (F-VTA-29), el vínculo con la nota de crédito y el stock (F-VTA-30) y el cierre de la épica la completan.

## Qué hay

- **Pantalla** `/ventas/devoluciones` («Devoluciones (RMA)», grupo Ventas, sección `ventas`): listado paginado (8 por página) con las columnas RMA, Tienda, Comprobante, Cliente, Producto, Forma de RMA, Motivo / operador y Estado; filtro Tienda (`FiltroEmpresa`, sigue a la empresa activa) y botón **Nueva devolución** (solo con `ventas` en edición). Prototipo: `design/pantallas/VentasDevoluciones.dc.html`.
- **Diálogo «Nueva devolución»**: Comprobante (solo facturas no borrador ni anuladas), Ítem, Cantidad, Forma de RMA (cinco opciones con descripción), Motivo y Observaciones. La **Cantidad** no está dibujada en el prototipo pero la base la exige (tope por línea). Si se cambia de tienda con el diálogo abierto, se cierra con aviso y no se guarda nada.
- **Catálogos del frontend** (`apps/web/src/lib/formasRma.ts`, `estadoRma.ts`): las cinco formas (`cambio_directo`, `enviado_a_proveedor`, `faltante_envio`, `reclamo_faltante`, `devolucion_importe`) y los tres estados (`abierto` «Abierta», `en_gestion` «En gestión», `cerrado` «Cerrada»). En la base son `check`, no tablas.

## Base de datos

| Objeto | Esquema | Notas |
|---|---|---|
| `dominio.rma` | `dominio` | Cabecera: organización, empresa, comprobante, `numero` `RMA-####`, forma, motivo, observaciones, estado, operador. |
| `dominio.rma_items` | `dominio` | Línea del comprobante, producto y cantidad. |
| `public.registrar_rma(comprobante, lineas, forma, motivo, observaciones)` | `public` | `security definer`. `ventas` en edición en la tienda del comprobante; factura confirmada no anulada; cantidad ≤ vendida − ya devuelta (comprobante tomado `for update`); número correlativo bajo lock de aviso; evento `rma.registrada`. |
| `public.listar_rma(busqueda, forma, estado, empresa, pagina, tamano)` | `public` | `security invoker`; delega en `private.listar_rma_sesion`, que deriva organización y tiendas del JWT. Orden: creación desc, número desc. |

Ambas tablas tienen RLS por organización y sección `ventas` (`select` con lectura o edición), **sin escritura directa** y `anon` sin privilegios. Las RPC llevan `revoke … from public, anon` y `grant execute … to authenticated`.

La cantidad ya devuelta se cuenta sobre los ítems de RMA anteriores de la misma línea. Una nota de crédito de «Devolución de productos» emitida aparte no se descuenta acá: el vínculo entre ambas es F-VTA-30.

## Pruebas

- pgTAP `supabase/tests/database/rma_alta.test.sql` (RLS, `check`, permisos, tope, numeración, listado, aislamiento).
- Vitest `apps/web/src/pages/ventas/devoluciones.test.tsx`.
- E2E `apps/web/e2e/ventas-rma.e2e.ts` (rótulo `[MSF-288:T009]`, video de evidencia): factura confirmada → alta de la devolución → número, ítem y listado. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público); ver `docs/e2e-app.md`.

## Reversión

Migraciones aditivas `20261213100000`, `20261213100100` y `20261213100200`; el camino de reversión está en el encabezado de cada una (`drop function`, `drop table dominio.rma_items`, `drop table dominio.rma`). El PR se revierte entero con `git revert -m 1`.
