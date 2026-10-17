# Stock · movimientos y mínimo (F-STK-02, F-STK-05)

Spec: `specs/20261017-120000-stock-movimientos/` (épica MSF-136). Esta guía cubre la historia F-STK-02
(MSF-153): existencias, registro de movimientos y motivos. El mínimo y los estados (F-STK-05) y la prevención de
negativos (F-STK-06) tienen su sección más abajo; el historial inmodificable es F-STK-03.

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Para qué | Escritura |
|-------|----------|-----------|
| `dominio.existencias` | Cantidad vigente por producto (stock único por organización, compartido entre empresas). Nace en 0 al crear el producto (disparador `productos_crear_existencias`) y se rellena para los productos existentes. | Solo la RPC. |
| `dominio.movimientos_stock` | Libro de solo agregado: tipo, cantidad informada, `diferencia` con signo, `saldo`, motivo, nota (≤ 500), fecha, responsable (`actor_id`, `actor_nombre`). | Solo la RPC. |
| `dominio.motivos_movimiento` | Motivos por organización (nombre único sin distinguir mayúsculas, tipos a los que aplica, activo). Se siembran 5 por organización: Compra a proveedor, Venta en local, Conteo de inventario, Devolución, Rotura o pérdida. | Solo Administrador (`private.puede_escribir()`); sin DELETE, se desactivan. |

Las tres tienen RLS por `organizacion_id` y `private.nivel_seccion('stock')` (`lectura`/`edicion` leen), y `anon` no
recibe ningún privilegio.

## RPC `public.registrar_movimiento_stock(p_producto, p_tipo, p_cantidad, p_motivo, p_nota, p_fecha)`

- *security definer*, `search_path = ''`; exige sesión, organización activa y `nivel_seccion('stock') = 'edicion'`.
  `revoke … from public, anon` y `grant execute … to authenticated`.
- `entrada`/`salida`: cantidad entera > 0. `ajuste`: se informa el **stock contado** (≥ 0) y se registra la diferencia.
- Fecha por defecto hoy; no se admite futura. El motivo debe estar activo, ser de la organización y aplicar al tipo.
- Bloquea la fila de existencias (`for update`): dos movimientos simultáneos se serializan y ninguno se pierde.
- Escribe el movimiento y el evento `stock.entrada` / `stock.salida` / `stock.ajuste` en `registro_actividad` en la misma
  transacción. Un saldo negativo lo rechaza el disparador de F-STK-06 (ver «Stock sin negativos») y revierte todo sin
  rastro.
- La fecha futura se compara contra `current_date` del servidor (UTC). Con husos por delante de UTC, cerca de la
  medianoche, el día local puede ser «mañana» para el servidor y la RPC lo rechaza con el mensaje de 22023: es un supuesto
  conocido; el diálogo limita la fecha máxima al día local.
- Organización y responsable salen de la sesión, nunca de parámetros.

## Interfaz (`apps/web`)

- Ítem **Stock** en la navegación (sección `stock`) y recurso `stock`; rutas `/stock` y `/stock/motivos`, ambas con
  carga diferida.
- `/stock`: producto, SKU y cantidad, con «Nuevo movimiento» (general y por fila) solo para quien edita. El diálogo
  muestra el stock resultante antes de confirmar, el responsable, deshabilita el doble envío y confirma «Movimiento
  registrado».
- `/stock/motivos` (Administrador): alta, renombre, tipos a los que aplica y activar/desactivar. Operador y Consulta no
  ven el acceso ni la pantalla.

## Stock mínimo y estados (F-STK-05, MSF-194)

Migración `20261017160000_stock_minimo_y_estados.sql` (aditiva, sin tablas nuevas):

- Columna `dominio.existencias.minimo` (entero ≥ 0, por defecto 0). Se escribe solo con
  `public.definir_minimo_stock(p_producto, p_minimo)` (*security definer*, exige `edicion` en Stock, registra el
  evento `stock.minimo` solo si el valor cambia; `anon` sin ejecución).
- Vista `public.stock_estados` (*security_invoker*, hereda la RLS; `anon` sin acceso) — contrato para Inicio (MSF-156) y
  MSF-231: `producto_id`, `organizacion_id`, `nombre`, `sku`, `activo`, `cantidad`, `minimo`, `estado`,
  `ultimo_movimiento_en`. El estado se calcula en la vista:

  | Estado | Condición |
  |--------|-----------|
  | `sin_stock` | `cantidad = 0` (aunque el mínimo sea 0) |
  | `stock_bajo` | `0 < cantidad <= minimo` |
  | `disponible` | `cantidad > minimo` (con mínimo 0, cualquier cantidad > 0) |

- `/stock` lee de `stock_estados`: columnas mínimo, estado y último movimiento; búsqueda por nombre o SKU (el texto se
  sanea antes de armar el filtro); filtro por estado; aviso «N productos sin stock y M con stock bajo» con «Ver solo
  alertas»; «Editar mínimo» (diálogo de carga diferida) solo para quien edita.
- Reversión F-STK-05 (migración posterior): `drop view public.stock_estados`, `drop function
  public.definir_minimo_stock(uuid, integer)` y `alter table dominio.existencias drop column minimo`.

## Stock sin negativos (F-STK-06, MSF-214)

Migración `20261017170000_stock_sin_negativos.sql` (aditiva, sin tablas nuevas; `dominio.existencias` ya tiene RLS).

- Doble barrera en la base: `check (cantidad >= 0)` (`existencias_cantidad_no_negativa`) y el disparador
  `existencias_sin_negativos` (`BEFORE INSERT OR UPDATE OF cantidad`) que levanta «No hay stock suficiente» con el
  detalle «Hay N unidades y la salida es de M.» (SQLSTATE 23514). Protege la RPC, el SQL directo y futuras RPC.
- Un rechazo no deja rastro: ni cambio de cantidad, ni fila en `movimientos_stock`, ni evento de actividad (todo
  ocurre en la transacción que revierte).
- Concurrencia: la RPC serializa con `for update`; dos salidas simultáneas que superan el stock → solo una se acepta.
- Diálogo «Registrar movimiento de stock»: apenas la salida supera el stock muestra la alerta «No hay stock suficiente»
  con el detalle y deshabilita «Registrar». Si el servidor igual rechaza (carrera, 23514) muestra el mismo mensaje,
  relee el stock y deja reintentar.
- Reversión (migración posterior): `drop trigger existencias_sin_negativos on dominio.existencias; drop function
  private.rechazar_stock_negativo(); alter table dominio.existencias drop constraint existencias_cantidad_no_negativa;`

## Reversión

Migraciones aditivas. Para deshacer (en una migración posterior; exportar antes los datos): `drop function
public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date)`, los disparadores
`organizaciones_sembrar_motivos_movimiento` y `productos_crear_existencias` con sus funciones, y
`drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias`. El detalle está en el
encabezado de cada migración.

## Pruebas

pgTAP `supabase/tests/database/stock_movimientos.test.sql` (roles, aislamiento, escritura directa, motivos, actividad,
`anon`), `stock_minimo_estados.test.sql` (F-STK-05: estados en los bordes, permisos, evento, aislamiento) y `stock_sin_negativos.test.sql` (F-STK-06); Vitest en `apps/web/src/lib/stock.test.ts` y `apps/web/src/pages/stock/*.test.tsx`.
