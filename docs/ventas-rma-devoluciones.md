---
owner: producto
sources:
  - specs
---

# Ventas · Devoluciones (RMA)

Guía de la épica MSF-178 (spec `specs/20261027-100000-ventas-rma-devoluciones`). Cubre **F-VTA-28 · Alta de RMA por ítem** (MSF-288), **F-VTA-29 · Formas de resolución y seguimiento** (MSF-304) y **F-VTA-30 · RMA con nota de crédito y stock** (MSF-320); el cierre (MSF-573) agrega la revisión de seguridad y el roadmap.

## Qué hay

- **Pantalla** `/ventas/devoluciones` («Devoluciones (RMA)», grupo Ventas, sección `ventas`): listado paginado (8 por página) con las columnas RMA, Tienda, Comprobante, Cliente, Producto, Forma de RMA, Motivo / operador y Estado; filtro Tienda (`FiltroEmpresa`, sigue a la empresa activa) y botón **Nueva devolución** (solo con `ventas` en edición). Prototipo: `design/pantallas/VentasDevoluciones.dc.html`.
- **Diálogo «Nueva devolución»**: Comprobante (solo facturas no borrador ni anuladas), Ítem, Cantidad, Forma de RMA (cinco opciones con descripción), Motivo y Observaciones. La **Cantidad** no está dibujada en el prototipo pero la base la exige (tope por línea). Si se cambia de tienda con el diálogo abierto, se cierra con aviso y no se guarda nada.
- **Catálogos del frontend** (`apps/web/src/lib/formasRma.ts`, `estadoRma.ts`): las cinco formas (`cambio_directo`, `enviado_a_proveedor`, `faltante_envio`, `reclamo_faltante`, `devolucion_importe`) y los tres estados (`abierto` «Abierta», `en_gestion` «En gestión», `cerrado` «Cerrada»). En la base son `check`, no tablas.

## Seguimiento (F-VTA-29)

- **Filtro «Forma de RMA»**: píldoras «Todas» + las cinco formas (`ToggleButtonGroup`), con recarga en el servidor (`p_forma_rma` de `listar_rma`), vuelta a la página 1 y el contador «N devoluciones». Con una forma sin registros: «Sin devoluciones · No hay registros con esa forma de RMA.». Al cambiar de empresa activa la pantalla se remonta y el filtro vuelve a «Todas».
- **Avance de estado** (no dibujado en el prototipo; requisito de la épica): quien tiene `ventas` en edición ve junto al chip de estado la acción **Pasar a En gestión** (Abierta) o **Cerrar** (En gestión); con la devolución Cerrada la acción queda deshabilitada. Éxito: «Devolución RMA-#### · {estado}»; error o conflicto: aviso en castellano. En ambos casos se vuelve a leer el listado.
- **Transición**: solo `abierto → en_gestion → cerrado`, sin saltos ni retrocesos (`22023`). Es idempotente (repetir el estado devuelve el actual, sin evento) y usa bloqueo optimista con `actualizado_en` (`40001` si otra persona la cambió). Evento `rma.estado_cambiado` («Pasó la devolución RMA-#### de Abierta a En gestión», con actor y tienda).

## Resolución: nota de crédito y stock (F-VTA-30)

- **Dos formas de resolver**, y cierran el RMA: **nota de crédito** (`vincular_nota_credito_rma`) o **reingreso de stock** (`reingresar_stock_rma`). La pantalla ofrece la que corresponde a la forma (propuesta a confirmar, *Decisiones abiertas* 6 de la spec): «Devolución de importe» → **Emitir nota de crédito** (diálogo con importe sin IVA y concepto); las demás → **Reingresar stock** (confirmación). Solo la ve quien tiene `ventas` en edición y un RMA sin resolver; la base valida el permiso real.
- **Vínculo visible**: en la columna «Forma de RMA», un RMA resuelto muestra «Nota de crédito N°» (enlace al comprobante de la nota) o «Stock reingresado». Las acciones no están dibujadas en el prototipo (*Decisiones abiertas* 7): se agregan con componentes del kit.
- **Nota de crédito**: reutiliza `public.emitir_nota_credito` (F-VTA-11) sin reimplementarla (tope acreditable, numeración, evento propio y, en «Devolución de productos», el stock de la nota). Exige la acción `emitir_nota_credito` de `ventas` en la tienda del RMA. `p_tipo` es `devolucion_importe` (importe y concepto) o `devolucion_productos` (sin líneas usa los ítems del RMA). Asigna `rma.nota_credito_id` y registra `rma.nota_credito_vinculada`.
- **Reingreso**: una **entrada** por ítem en el depósito de origen de su línea (o en el indicado en `p_deposito_id`) con `public.registrar_movimiento_stock`, motivo de sistema «Devolución» y nota igual al número del RMA (`RMA-0001`, que ya lleva el prefijo). `registrar_movimiento_stock` exige además `stock` en edición: sin ese permiso falla y no queda nada a medias. Marca `rma.stock_reingresado_en` y registra `rma.stock_reingresado`.
- **Idempotencia y exclusión**: repetir cualquiera devuelve el RMA sin emitir otra nota ni duplicar movimientos (el RMA se toma `for update`). Un RMA resuelto por nota no admite reingreso y viceversa (`55000`), para no devolver dos veces la mercadería.
- **Columnas nuevas** en `dominio.rma` (migración `20270113120000`): `nota_credito_id` (FK compuesta a `comprobantes_venta`) y `stock_reingresado_en` (marcador del reingreso; la spec nombra solo la primera, esta segunda evita adivinar el reingreso leyendo notas de texto). `listar_rma` devuelve además `nota_credito_id`, `nota_credito_numero` y `stock_reingresado` (migración `20270113120300`).

## Base de datos

| Objeto | Esquema | Notas |
|---|---|---|
| `dominio.rma` | `dominio` | Cabecera: organización, empresa, comprobante, `numero` `RMA-####`, forma, motivo, observaciones, estado, operador. |
| `dominio.rma_items` | `dominio` | Línea del comprobante, producto y cantidad. |
| `public.registrar_rma(comprobante, lineas, forma, motivo, observaciones)` | `public` | `security definer`. `ventas` en edición en la tienda del comprobante; factura confirmada no anulada; cantidad ≤ vendida − ya devuelta (comprobante tomado `for update`); número correlativo bajo lock de aviso; evento `rma.registrada`. |
| `public.listar_rma(busqueda, forma, estado, empresa, pagina, tamano)` | `public` | `security invoker`; delega en `private.listar_rma_sesion`, que deriva organización y tiendas del JWT. Orden: creación desc, número desc. Desde F-VTA-29 devuelve también `actualizado_en` (sello del bloqueo optimista). |
| `public.cambiar_estado_rma(id, estado, actualizado_en)` | `public` | `security definer`. `ventas` en edición en la tienda del RMA; transición lineal; idempotente; bloqueo optimista (`for update` + `actualizado_en`, renovado con `clock_timestamp()`); evento `rma.estado_cambiado`. Errores: `42501` permiso, `P0002` no existe, `22023` estado o transición inválidos, `40001` conflicto. |

Ambas tablas tienen RLS por organización y sección `ventas` (`select` con lectura o edición), **sin escritura directa** y `anon` sin privilegios. Las RPC llevan `revoke … from public, anon` y `grant execute … to authenticated`.

La cantidad ya devuelta se cuenta sobre los ítems de RMA anteriores de la misma línea. Una nota de crédito de «Devolución de productos» emitida aparte (sin pasar por el RMA) no se descuenta acá.

## Seguridad (revisión de cierre, MSF-573)

Revisión de `registrar_rma`, `listar_rma`, `cambiar_estado_rma`, `vincular_nota_credito_rma` y `reingresar_stock_rma`; sin hallazgos abiertos:

- Todas las RPC de escritura son `security definer` con `search_path = ''`; organización y actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de parámetros. Cada una filtra el RMA por organización y valida el permiso **en la empresa del RMA** (`nivel_ventas_en_empresa` o `puede_accion_comprobante`).
- `revoke … from public, anon` y `grant execute … to authenticated` explícitos; `anon` no ejecuta ninguna (cubierto por pgTAP y por la prueba global de `anon`).
- La nota y el stock reutilizan `emitir_nota_credito` y `registrar_movimiento_stock`, que validan sus propios permisos (`emitir_nota_credito`; `stock` en edición): sin ellos falla todo y no queda nada a medias.
- Concurrencia: el RMA se toma `for update` (nota, reingreso, estado) y el comprobante en el alta; reintentos idempotentes y exclusión mutua nota/reingreso (`55000`).
- Las tablas tienen RLS y no admiten escritura directa.

## Pruebas

- pgTAP `supabase/tests/database/rma_nota_stock.test.sql` (FK, nota emitida y vinculada, reingreso por depósito con motivo «Devolución», idempotencia, exclusión, permisos, aislamiento, `anon`, listado con el vínculo).
- Vitest `apps/web/src/pages/ventas/devoluciones.nota.test.tsx` (vínculo visible, acciones con y sin permiso, errores, cambio de empresa).
- pgTAP `supabase/tests/database/rma_alta.test.sql` (RLS, `check`, permisos, tope, numeración, listado, aislamiento).
- pgTAP `supabase/tests/database/rma_seguimiento.test.sql` (transición válida e inválida, idempotencia, bloqueo optimista, evento, permisos, aislamiento y `anon`; filtro `p_forma_rma`).
- Vitest `apps/web/src/pages/ventas/devoluciones.test.tsx` y `devoluciones.seguimiento.test.tsx` (filtro, contador, chips, avance de estado, teclado, cambio de empresa).
- E2E `apps/web/e2e/ventas-rma.e2e.ts` (rótulos `[MSF-288:T009]` y `[MSF-304:T014]`, video de evidencia): factura confirmada → alta de la devolución → número, ítem y listado; y filtro por forma → avance Abierta → En gestión → Cerrada. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público); ver `docs/e2e-app.md`.

## Reversión

F-VTA-30: migraciones aditivas `20270113120000` (`alter table dominio.rma drop column stock_reingresado_en, drop column nota_credito_id`), `20270113120100` (`drop function public.vincular_nota_credito_rma(uuid, text, jsonb, text)`), `20270113120200` (`drop function public.reingresar_stock_rma(uuid, uuid)`) y `20270113120300` (recrea `listar_rma` sin las tres columnas del vínculo; se vuelve a `20270113110100`). Las notas emitidas y los movimientos de stock del libro no se deshacen solos.

Migraciones aditivas `20270113100000`, `20270113100100`, `20270113100200`, `20270113110000` (`drop function public.cambiar_estado_rma(uuid, text, timestamptz)`) y `20270113110100` (recrea `listar_rma` con `actualizado_en`; se vuelve a la definición de `20270113100200`); el camino de reversión está en el encabezado de cada una (`drop function`, `drop table dominio.rma_items`, `drop table dominio.rma`). El PR se revierte entero con `git revert -m 1`.
