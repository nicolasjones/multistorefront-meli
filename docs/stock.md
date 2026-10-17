# Stock · movimientos (F-STK-02)

Spec: `specs/20261017-120000-stock-movimientos/` (épica MSF-136). Esta guía cubre la historia F-STK-02
(MSF-153): existencias, registro de movimientos y motivos. Historial inmodificable (F-STK-03), mínimo y estados
(F-STK-05) y prevención de negativos con mensaje claro (F-STK-06) llegan con sus propias historias y migraciones.

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
  transacción. Un saldo negativo viola `saldo >= 0` y revierte todo sin rastro (el mensaje «No hay stock suficiente»
  llega con F-STK-06).
- Organización y responsable salen de la sesión, nunca de parámetros.

## Interfaz (`apps/web`)

- Ítem **Stock** en la navegación (sección `stock`) y recurso `stock`; rutas `/stock` y `/stock/motivos`, ambas con
  carga diferida.
- `/stock`: producto, SKU y cantidad, con «Nuevo movimiento» (general y por fila) solo para quien edita. El diálogo
  muestra el stock resultante antes de confirmar, el responsable, deshabilita el doble envío y confirma «Movimiento
  registrado».
- `/stock/motivos` (Administrador): alta, renombre, tipos a los que aplica y activar/desactivar. Operador y Consulta no
  ven el acceso ni la pantalla.

## Reversión

Migraciones aditivas. Para deshacer (en una migración posterior; exportar antes los datos): `drop function
public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date)`, los disparadores
`organizaciones_sembrar_motivos_movimiento` y `productos_crear_existencias` con sus funciones, y
`drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias`. El detalle está en el
encabezado de cada migración.

## Pruebas

pgTAP `supabase/tests/database/stock_movimientos.test.sql` (roles, aislamiento, escritura directa, motivos, actividad,
`anon`); Vitest en `apps/web/src/lib/stock.test.ts` y `apps/web/src/pages/stock/*.test.tsx`.
