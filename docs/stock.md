# Stock · movimientos, historial, mínimo y sin negativos (épica MSF-136)

Spec: `specs/20261017-120000-stock-movimientos/` (épica MSF-136). Esta guía cubre F-STK-02 (MSF-153): existencias,
registro de movimientos y motivos. El mínimo y los estados (F-STK-05), la prevención de negativos (F-STK-06) y el
historial inmodificable (F-STK-03) tienen su sección más abajo.

Recorrido E2E de cierre (SC-001): `apps/web/e2e/stock-movimientos.e2e.ts` (ver `docs/e2e-app.md`).

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Para qué | Escritura |
|-------|----------|-----------|
| `dominio.existencias` | Cantidad vigente por producto (stock único por organización, compartido entre empresas). Nace en 0 al crear el producto (disparador `productos_crear_existencias`) y se rellena para los productos existentes. | Solo la RPC. |
| `dominio.movimientos_stock` | Libro de solo agregado: tipo, cantidad informada, `diferencia` con signo, `saldo`, motivo, nota (≤ 500), fecha, responsable (`actor_id`, `actor_nombre`). | Solo la RPC. |
| `dominio.motivos_movimiento` | Motivos por organización (nombre único sin distinguir mayúsculas, tipos a los que aplica, activo). Se siembran 6 por organización: Compra a proveedor, Venta en local, Conteo de inventario, Devolución, Rotura o pérdida y Anulación de ingreso de mercadería (F-PRV-06). | Solo Administrador (`private.puede_escribir()`); sin DELETE, se desactivan. |

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

## Stock actual en vivo (F-STK-01, MSF-268)

`/stock` se actualiza solo cuando otra sesión cambia las existencias, sin pantalla nueva.

- **Publicación**: la migración `20261018190000_stock_existencias_realtime.sql` agrega `dominio.existencias` a la
  publicación `supabase_realtime` (Supabase self-hosted, sin Cloud). Es idempotente y no altera la tabla. Realtime
  aplica a cada suscriptor la RLS de la tabla, así que otra organización no recibe sus cambios (pgTAP
  `stock_realtime.test.sql`).
- **Suscripción**: el hook `apps/web/src/lib/useExistenciasRealtime.ts` escucha `postgres_changes` sobre
  `dominio.existencias` filtrado por la organización activa, agrupa ráfagas (300 ms: una tanda de avisos, un solo
  refresco) y cierra el canal al desmontar o cambiar de organización.
- **Qué se conserva al refrescar**: `list.tsx` vuelve a pedir listado y resumen con la búsqueda, el filtro de estado
  y la página actuales; la tabla no se vacía, así que el foco no se mueve.
- **Sin conexión en vivo**: si el canal falla (`CHANNEL_ERROR` / `TIMED_OUT`) o no se puede crear, queda un aviso en
  consola y el listado sigue usable por consulta normal (recargando o tras registrar un movimiento).
- **Reversión**: `alter publication supabase_realtime drop table dominio.existencias;` en una migración posterior.
  El listado vuelve a cargar solo por consulta.
- **Pruebas**: Vitest `useExistenciasRealtime.test.tsx` y `pages/stock/list.test.tsx`; E2E de dos sesiones
  `apps/web/e2e/stock-actual-vivo.e2e.ts` (requiere el stack local, ver `docs/e2e-app.md`).

## Reversión

Migraciones aditivas. Para deshacer (en una migración posterior; exportar antes los datos): `drop function
public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date)`, los disparadores
`organizaciones_sembrar_motivos_movimiento` y `productos_crear_existencias` con sus funciones, y
`drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias`. El detalle está en el
encabezado de cada migración.

## Pruebas

pgTAP `supabase/tests/database/stock_movimientos.test.sql` (roles, aislamiento, escritura directa, motivos, actividad,
`anon`), `stock_minimo_estados.test.sql` (F-STK-05: estados en los bordes, permisos, evento, aislamiento) y `stock_sin_negativos.test.sql` (F-STK-06); Vitest en `apps/web/src/lib/stock.test.ts` y `apps/web/src/pages/stock/*.test.tsx`.

## Historial de movimientos (F-STK-03)

Ruta `/stock/movimientos` (pestañas «Stock actual · Movimientos»; visible con `lectura` o `edicion` en Stock,
solo lectura para todos). Migración `20261017150000_stock_historial_inmutable.sql` (aditiva; no crea tablas):

- **Inmutabilidad**: el disparador `movimientos_stock_inmutable_fila` (`BEFORE UPDATE OR DELETE`) y
  `movimientos_stock_inmutable_truncate` (`BEFORE TRUNCATE`) rechazan siempre con «Los movimientos de stock no se
  pueden modificar» (errcode `42501`), también para el propietario de la función; además se revocan
  `update`, `delete` y `truncate`. Para corregir un error se registra un movimiento nuevo (ajuste).
- **Baja de organización**: la migración `20261017150100_stock_historial_borrado_en_cascada.sql` deja pasar el
  `delete` de fila solo cuando la organización padre ya no existe (cascada de `public.organizaciones`); un `delete`
  directo sigue rechazado. Borrar `public.organizaciones` queda restringido: `authenticated` solo tiene `select` (RLS `organizaciones_select`) y únicamente `service_role` tiene `delete` (migración `20260908172920_fundacion_multitenant.sql`, líneas 264 y 276), así que un usuario de la app no puede abrir ese camino. Aditiva (reemplaza el cuerpo de la función; reversión: la definición de la migración anterior).
- **`public.listar_movimientos_stock(p_producto, p_limite = 25, p_desplazamiento = 0)`**: *security invoker* (rige la
  RLS por organización y `nivel_seccion('stock')`; `ninguno` no recibe filas). Orden `creado_en desc, id desc`, tope
  de 100 por página, columna `total` con el total del filtro y filtro opcional por producto. Devuelve nombre y SKU del
  producto (`left join`: sin acceso a Catálogo el movimiento igual aparece como «Producto no disponible»), motivo, nota,
  cantidad, diferencia, saldo y responsable. `anon` sin acceso; `authenticated` con grant explícito.
- **Pruebas**: pgTAP `supabase/tests/database/stock_historial.test.sql`; Vitest `apps/web/src/pages/stock/movimientos.test.tsx`.
- **Reversión** (migración posterior): quitar la función `public.listar_movimientos_stock(uuid, integer, integer)`, los
  disparadores (fila, truncate y sentencia `movimientos_stock_inmutable_sentencia`, que rechaza con 42501 aunque la RLS oculte las filas; deja pasar solo la cascada de organización) y las funciones `private.rechazar_*_movimiento_stock()`; el encabezado de la migración trae los comandos.

## Eventos de stock (F-STK-04, MSF-249)

Cada movimiento aceptado emite un evento `stock.actualizado` a la cola `public.cola_eventos`. Contrato, cola, reclamo y reversión en `docs/stock-eventos.md`.

## Disponibilidad del producto (F-CAT-17, MSF-335)

Catálogo deriva la etiqueta de disponibilidad (`stock` / `sin_stock`) de `dominio.existencias.cantidad` con `private.disponibilidad_producto(uuid)` y `private.productos_con_stock()`. **Contrato para MSF-292** (depósitos y reservas): al llegar, solo cambia el cuerpo de esas funciones (disponible = cantidad − reservado, sumando depósitos); consumidores, vista y filtro no cambian. Detalle en `docs/catalogo.md` («Disponibilidad del producto»).
