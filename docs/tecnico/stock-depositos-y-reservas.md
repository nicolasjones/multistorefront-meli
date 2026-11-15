---
owner: tecnico
sources:
  - supabase/migrations
  - apps/web/src/pages/stock
---

# Stock · depósitos, traslados y reservas (MSF-292)

Contratos, datos y operación de la épica MSF-292 (F-STK-14 · MSF-316, F-STK-15 · MSF-353 y F-STK-16 · MSF-337). El
detalle de producto (qué resuelve, para quién y límites) está en
[Stock · depósitos y reservas](../producto/stock-depositos-y-reservas.md).

!!! warning "Estado de la rama"
    La implementación vive en `epic/MSF-292-stock-stock-depositos-y-reservas`; a la fecha de esta página no está
    mergeada a `main`. Las migraciones, rutas y pruebas citadas existen en esa rama; en `main` todavía no están.

## Migraciones (aditivas)

| Migración | Contenido |
|-----------|-----------|
| `20261023120000_depositos_tablas.sql` | `dominio.depositos`, `dominio.depositos_empresas`, `dominio.existencias_deposito`; `existencias.reservado`; `movimientos_stock.deposito_id`; backfill del «Depósito principal»; RLS; `existencias_deposito` en `supabase_realtime` |
| `20261023120100_depositos_gestion.sql` | RPC `crear_deposito`, `actualizar_deposito`, `definir_deposito_por_defecto`, `cambiar_activo_deposito` |
| `20261023120200_stock_movimiento_deposito.sql` | `private.aplicar_movimiento_deposito` y `registrar_movimiento_stock` con `p_deposito` |
| `20261023120300_stock_evento_deposito.sql` | Carga ampliada de `stock.actualizado` (`deposito_id`, `reservado`, `disponible`) |
| `20261023120400_stock_lecturas_deposito.sql` | Vistas `stock_por_deposito` y `depositos_listado`; `stock_estados` y `listar_movimientos_stock` ampliadas |
| `20261023120500_ingresos_anular_deposito_original.sql` | `anular_ingreso_mercaderia` devuelve la salida al depósito del movimiento de entrada original |
| `20261023130000_stock_traslado.sql` | `movimientos_stock.traslado_id`; RPC `trasladar_stock`; motivo de sistema; `listar_movimientos_stock` gana `traslado_id` |
| `20261023130100_stock_reservas.sql` | `dominio.reservas_stock`; RPC `reservar_stock`, `liberar_reserva`, `descontar_reserva` |
| `20261023130200_disponibilidad_con_reservas.sql` | `private.disponibilidad_producto` y `private.productos_con_stock` evalúan el disponible |
| `20261023130300_stock_evento_reserva.sql` | Disparadores de evento sobre `reservas_stock` (`reserva`, `liberacion`) |
| `20261023130400_stock_motivo_traslado_reservado.sql` | El motivo «Traslado entre depósitos» solo se usa desde `trasladar_stock` |

Cada archivo trae su reversión en el encabezado. Nada se destruye en el mismo PR que lo crea. El DER completo del
grafo afectado está en [Datos y DER](datos.md#stock-depositos-y-reservas-msf-292).

## Modelo de datos

Todo lo nuevo es negocio de Stock → esquema **`dominio`** (Principio VII). Ninguna tabla nueva admite escritura
directa de `authenticated`: escriben solo las RPC *security definer*.

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.depositos` | **nueva** | `id`, `organizacion_id`, `nombre` (≤ 80, único por organización sin distinguir mayúsculas), `direccion` (≤ 200, opcional), `activo`, `por_defecto`, `creado_en`, `updated_at`. Restricciones `depositos_defecto_activo` (el por defecto está activo) y `unique (id, organizacion_id)`. Índices únicos parciales `depositos_nombre_uq` y `depositos_por_defecto_uq` (a lo sumo un por defecto por organización). Sin `delete`: se desactivan. |
| `dominio.depositos_empresas` | **nueva** | Relación depósito ↔ empresa («Venden desde acá»), PK `(deposito_id, empresa_id)`. El disparador `depositos_empresas_validar` rechaza un depósito o una empresa de otra organización. |
| `dominio.existencias_deposito` | **nueva** | `cantidad` (≥ 0) y `reservado` (≥ 0, `reservado ≤ cantidad`) por producto y depósito; PK `(producto_id, deposito_id)` y FK compuestas a `existencias` y `depositos`. |
| `dominio.reservas_stock` | **nueva** | `producto_id`, `deposito_id`, `cantidad` (> 0), `estado` (`activa`/`descontada`/`liberada`), `referencia` (≤ 200, única por organización cuando existe), `responsable_id`, `responsable_nombre`, `creado_en`, `resuelto_en`, `updated_at`. `check` de coherencia estado/`resuelto_en`. |
| `dominio.existencias` | **alterada** | Gana `reservado integer not null default 0` y el `check existencias_reservado_valido` (`reservado ≥ 0 and reservado ≤ cantidad`). `cantidad` sigue siendo el **stock total único**: la suma de los depósitos, mantenida en la misma transacción. |
| `dominio.movimientos_stock` | **alterada** | Gana `deposito_id uuid` (FK compuesta a `depositos`) en F-STK-14 y `traslado_id uuid` en F-STK-15, con índice único parcial `(traslado_id, tipo)`: un traslado tiene a lo sumo una salida y una entrada. El libro sigue siendo de solo agregado. |

### RLS

- Las tres tablas nuevas (`depositos`, `depositos_empresas`, `existencias_deposito`) y `reservas_stock` tienen RLS
  por `organizacion_id` con `private.organizacion_id()` y `private.nivel_seccion('stock') in ('lectura','edicion')`
  para `select`. Sin `insert`/`update`/`delete` directos; `anon` sin privilegios.
- Se eligió la **vía única por RPC** en lugar de policies de escritura: las reglas (un solo depósito por defecto, no
  desactivar con unidades) no se pueden expresar en una policy de fila.
- `dominio.existencias_deposito` se publica en `supabase_realtime` (bloque idempotente al final de
  `20261023120000_depositos_tablas.sql`).

### Backfill (D-9)

`20261023120000_depositos_tablas.sql` siembra «Depósito principal» (activo y por defecto) en **todas** las
organizaciones —también las que no tienen existencias, para que un movimiento sin depósito siempre tenga destino— y
un disparador `organizaciones_sembrar_deposito_principal` lo crea en cada organización nueva. La cantidad actual de
cada producto pasa a ese depósito (el total no cambia) y los movimientos históricos quedan con su `deposito_id`
(suspendiendo durante la migración los disparadores de inmutabilidad del libro, dentro de la misma transacción).

## RPC de gestión de depósitos (solo Administrador)

Migración `20261023120100_depositos_gestion.sql`. Todas *security definer* con `search_path = ''`, `revoke … from
public, anon` y `grant execute … to authenticated`, y con `private.exigir_administrador_depositos()` (que exige
`private.puede_escribir()`); sin Administrador responden `42501` con «Solo el Administrador puede definir depósitos».

| RPC | Reglas |
|-----|--------|
| `crear_deposito(p_nombre, p_direccion, p_empresas)` | Nombre 1…80 recortado y único (`23505` «Ya existe un depósito con ese nombre»); dirección ≤ 200; empresas de la organización. Nace activo y no por defecto. |
| `actualizar_deposito(p_deposito, p_nombre, p_direccion, p_empresas)` | Mismo formulario; `p_empresas = null` no toca el conjunto de empresas. |
| `definir_deposito_por_defecto(p_deposito)` | Bloquea los depósitos de la organización y deja exactamente uno por defecto; un inactivo no puede serlo («Activá el depósito antes de usarlo por defecto»). |
| `cambiar_activo_deposito(p_deposito, p_activo)` | El por defecto no se desactiva («El depósito por defecto no se puede desactivar»); uno con unidades tampoco («Tiene stock: trasladá la mercadería antes de desactivarlo»). |

Los mensajes que la UI espeja están en `apps/web/src/lib/depositos.ts` (`MENSAJES_DE_LA_BASE`). La gestión deja
actividad: `stock.deposito_creado`, `stock.deposito_editado`, `stock.deposito_defecto` y `stock.deposito_activo`.

## Movimientos por depósito

Migración `20261023120200_stock_movimiento_deposito.sql`:

- `private.aplicar_movimiento_deposito(p_organizacion, p_producto, p_deposito, p_delta_cantidad,
  p_delta_reservado default 0, p_marcar_movimiento default true)` es la **única** rutina que cambia cantidad y
  reservado. Serializa por producto (`select … for update` sobre `dominio.existencias`), mantiene `existencias` =
  suma de `existencias_deposito` en la misma transacción y rechaza con `23514` «No hay stock suficiente» cuando el
  **disponible del depósito** quedaría negativo. El rechazo revierte todo: sin movimiento, sin evento, sin actividad.
- `public.registrar_movimiento_stock` gana `p_deposito uuid default null` **al final** (de 6 a 7 parámetros; la
  migración hace `drop` de la firma anterior y `create` de la nueva para no dejar dos sobrecargas ambiguas en
  PostgREST). Sin `p_deposito` usa el depósito por defecto: los llamadores anteriores siguen funcionando. El
  depósito se toma `for share`, así que no se puede desactivar mientras entra o sale mercadería, y uno inactivo no
  admite movimientos. En un **ajuste**, `p_cantidad` es el stock contado **en ese depósito**.
- El libro guarda `deposito_id`; `saldo` y `stock.actualizado.cantidad` siguen siendo el total único.

## Traslado entre depósitos

Migración `20261023130000_stock_traslado.sql`:

```ts
trasladar_stock(
  p_producto uuid,
  p_origen uuid,
  p_destino uuid,
  p_cantidad integer,
  p_nota text default null,
  p_fecha date default current_date
) returns table (
  traslado_id uuid, movimiento_salida_id uuid, movimiento_entrada_id uuid,
  origen_cantidad integer, origen_disponible integer,
  destino_cantidad integer, destino_disponible integer
)
```

- *security definer*, `search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`; exige
  `private.nivel_seccion('stock') = 'edicion'` («Tu rol no puede trasladar stock», `42501`).
- Rechaza: origen = destino, cantidad no entera o ≤ 0, depósitos de otra organización o inactivos, fecha futura,
  nota > 500 caracteres y cantidad mayor que el **disponible del origen**. El rechazo no deja rastro.
- Toma los dos depósitos `for share` en orden por `id` (sin cruces) y serializa por producto.
- Aplica la salida en el origen y la entrada en el destino con `private.aplicar_movimiento_deposito`, en **una
  transacción**, con el motivo de sistema «Traslado entre depósitos» (se crea por organización la primera vez; el
  motivo se usa por id, sin validar «aplica a»).
- Los dos movimientos quedan vinculados por `traslado_id`. El **total y el reservado total no cambian** y **no se
  emite `stock.actualizado`**: `private.emitir_stock_actualizado` sale temprano si `new.traslado_id is not null`.
- Registra la actividad `stock.traslado`.
- `20261023130400_stock_motivo_traslado_reservado.sql` agrega el disparador `movimientos_stock_motivo_traslado`:
  un movimiento con el motivo «Traslado entre depósitos» y **sin** `traslado_id` se rechaza (limpiaría el libro y
  rompería el rotulado «Traslado · …»).

## Reservas de productos a pedido

Migración `20261023130100_stock_reservas.sql`. Las tres RPC: *security definer*, `search_path = ''`, `revoke … from
public, anon`, `grant execute … to authenticated`, exigen `private.nivel_seccion('stock') = 'edicion'` y serializan
por producto (`select … for update` sobre `existencias`); el disponible nunca queda `< 0`.

| RPC | Hace | Rechaza |
|-----|------|---------|
| `reservar_stock(p_producto, p_deposito, p_cantidad, p_referencia default null)` | Crea una reserva `activa` y sube `reservado` en el depósito y en el total (`0` en cantidad). La misma `p_referencia` devuelve la reserva existente sin duplicar. | Producto que no es «A pedido» («Solo se puede reservar stock de productos A pedido»); cantidad ≤ 0; depósito inexistente o inactivo; cantidad > disponible del depósito («No hay stock suficiente», `23514`); misma referencia con otros datos (`23505` «Esa referencia ya tiene una reserva con otros datos»). |
| `liberar_reserva(p_reserva)` | `activa → liberada`; baja `reservado`; la `cantidad` no cambia. | Reserva inexistente o ajena; ya `descontada`/`liberada` («La reserva ya fue &lt;estado&gt;»). |
| `descontar_reserva(p_reserva)` | `activa → descontada`; baja `cantidad` y `reservado` en la cantidad reservada y registra una **salida** en el libro, en el depósito de la reserva, con el motivo de sistema «Entrega de producto a pedido» (`{salida}`, creado por organización la primera vez). Todo en una transacción. | Reserva inexistente o ajena; ya `descontada`/`liberada`. |

- **Idempotencia (D-8):** la `p_referencia` la define quien llama (p. ej. la línea de venta). Un reintento con los
  mismos datos devuelve la misma reserva y no suma `reservado` ni emite otro evento; con la misma referencia y otro
  producto, depósito o cantidad se rechaza (`23505`).
- Actividad: `stock.reserva`, `stock.reserva_liberada` y `stock.reserva_descontada`.
- La nota de la salida del descuento es `Reserva <referencia o id>` (≤ 500 caracteres).

## Lecturas

Migración `20261023120400_stock_lecturas_deposito.sql` (sin tablas nuevas):

| Objeto | Qué devuelve |
|---|---|
| `public.stock_por_deposito` (nueva, *security_invoker*) | `producto_id`, `deposito_id`, `organizacion_id`, `cantidad`, `reservado`, `disponible` por producto y depósito. |
| `public.depositos_listado` (nueva, *security_invoker*) | La tabla de la pantalla: `nombre`, `direccion`, `activo`, `por_defecto`, `empresas` (jsonb), `empresa_ids` (uuid[]), `productos_con_stock`, `unidades`, `creado_en`. |
| `public.stock_estados` (ampliada) | Gana `reservado` y `disponible` al final; el `estado` pasa a calcularse sobre el **disponible total** (`sin_stock` = 0, `stock_bajo` ≤ mínimo). Con `reservado = 0` el resultado es idéntico al anterior. |
| `public.listar_movimientos_stock` (ampliada) | Gana `deposito_id` y `deposito_nombre` al final; F-STK-15 le agrega `traslado_id`. Sigue *security invoker*, con tope de 100 por página y columna `total`. |

Todas son `security_invoker` (rige la RLS de Stock) y `anon` no tiene acceso.

## Eventos

- `stock.actualizado` (migración `20261023120300_stock_evento_deposito.sql`): la carga gana, de forma **aditiva**,
  `deposito_id`, `reservado` (total) y `disponible` (total). `cantidad` sigue siendo el saldo total y `diferencia` el
  cambio del movimiento. Se emite una vez por movimiento, en la misma transacción (disparador `AFTER INSERT` sobre el
  libro).
- **Un traslado no emite evento**: el total no cambia (D-5).
- Reservar y liberar emiten el evento con `diferencia = 0`, `movimiento_id = null` y `reserva_id`, con
  `tipo_movimiento` `reserva` o `liberacion` (migración `20261023130300_stock_evento_reserva.sql`; disparadores
  `reservas_stock_evento_alta` y `reservas_stock_evento_liberacion`). Descontar **no** emite por su cuenta: lo emite
  la salida que registra en el libro, así no hay dos eventos por el mismo cambio. La clave de idempotencia es
  `<reserva_id>:reserva` / `<reserva_id>:liberacion`.

## Disponibilidad del producto (FR-036)

Migración `20261023130200_disponibilidad_con_reservas.sql`: `private.disponibilidad_producto` y
`private.productos_con_stock` (MSF-179, `20261022120900_catalogo_disponibilidad.sql`) pasan a evaluar el
**disponible** (`cantidad − reservado > 0`) con el mismo contrato de salida. La etiqueta manual («A pedido», «Stock
entrante en breve») sigue mandando aun con reservas activas; los productos derivados pasan a «Sin stock» cuando el
disponible llega a 0.

## Interfaz (`apps/web`)

- **Ruta y pestaña.** `/stock/depositos` (`apps/web/src/App.tsx`), carga diferida, envuelta en
  `RequiereOrganizacionActiva` y `RequiereAccesoSeccion seccion="stock"`. La pestaña «Depósitos de mercadería» vive
  en `apps/web/src/pages/stock/PestanasStock.tsx` junto a «Stock actual», «Movimientos» e «Ingreso de mercadería». No
  hay recurso Refine propio ni ítem nuevo en el menú lateral: se llega desde la pestaña.
- **Pantalla de depósitos.** `apps/web/src/pages/stock/depositos.tsx` (exporta `DepositosStock`) + `DepositoDialog.tsx`
  (carga diferida) + `apps/web/src/lib/depositos.ts`. La tabla muestra Depósito, Dirección, Venden desde acá, Productos
  con stock, Unidades, Por defecto, Activo y las acciones; «Nuevo depósito de mercadería», «Usar por defecto», «Editar»
  y el switch «Activo» solo para el Administrador (`usePuedeEscribir()` → `contexto.puede_escribir`). El diálogo pide
  Nombre, Dirección y «Pueden vender desde acá» (solo empresas activas), y en el alta la empresa activa viene
  preseleccionada.
- **Filtro por empresa activa.** `listarDepositos(empresaId)` filtra con `.contains('empresa_ids', [empresaId])` sobre
  `depositos_listado`; con «Todas mis empresas» (`empresaActivaId === null`) lista todos. La pantalla guarda la empresa
  con la que cargó y, si la empresa activa cambia, no muestra filas de la anterior, invalida el resultado y **cierra el
  diálogo abierto** con el aviso «Cambiaste de empresa: cerramos el formulario del depósito para no mezclar datos.
  Volvé a abrirlo si querés seguir».
- **Stock actual.** `apps/web/src/pages/stock/list.tsx`: columnas **Stock**, **Reservado** y **Disponible** (a la
  derecha) y control **«Depósito de mercadería»** con «Todos los depósitos» por defecto; al elegir un depósito se lee
  `stock_por_deposito` y las cifras pasan a ser las de ese depósito. El estado sigue viniendo de `stock_estados`
  (totales): la barra lo aclara («El control de depósito cambia las cifras, no el estado (se calcula sobre el
  disponible total)»).
- **Traslado.** `apps/web/src/pages/stock/TrasladarDialog.tsx` (carga diferida desde `list.tsx`) + `lib/traslados.ts`.
  La acción «Trasladar» por fila solo aparece con `nivel === 'edicion'` en la sección `stock`
  (`useNivelSeccion('stock')`). El diálogo muestra «Disponible en &lt;depósito&gt;: N · Stock N · Reservado N» debajo del
  selector de origen, avisa «No hay stock suficiente» si la cantidad pasa el disponible (sin llamar a la RPC) y
  confirma con «Traslado registrado».
- **Movimiento.** `NuevoMovimientoDialog.tsx` suma el campo **«Depósito de mercadería»** con el por defecto
  preseleccionado y el helper «Stock en &lt;depósito&gt;: N · Reservado N · Disponible N»; la RPC se llama con
  `p_deposito`. La barrera es el **disponible** del depósito.
- **Movimientos.** `apps/web/src/pages/stock/movimientos.tsx`: columna «Depósito» en el detalle, resumen por producto
  con **Queda**, **Reserv.** y **Disp.**, y el tipo rotulado «Traslado · Salida» / «Traslado · Entrada» cuando el
  movimiento tiene `traslado_id`.
- **Tiempo real.** `apps/web/src/lib/useExistenciasRealtime.ts` se suscribe a `dominio.existencias` **y**
  `dominio.existencias_deposito` de la organización activa (agrupando con `ESPERA_AGRUPAR_MS = 300`).
- **Permisos.** Ver la pantalla exige `lectura` o `edicion` en `stock`; administrar depósitos exige Administrador
  (`private.puede_escribir()`); trasladar y registrar movimientos exigen `edicion` en `stock`.

## Pruebas

- pgTAP (`pnpm test:db`): `supabase/tests/database/stock_depositos.test.sql` (FR-001/003/004/006/007/015, SC-001/004/005),
  `stock_deposito_disponible.test.sql` (FR-008/009/013, SC-006), `stock_traslado.test.sql` (FR-020…FR-024),
  `stock_reservas.test.sql` (FR-030…FR-038) e `ingresos_anular_deposito_original.test.sql`.
- Vitest: `apps/web/src/pages/stock/depositos.test.tsx`, `TrasladarDialog.test.tsx`, `list.test.tsx`,
  `movimientos.test.tsx`, `NuevoMovimientoDialog.test.tsx` y `apps/web/src/lib/useExistenciasRealtime.test.tsx`.
- E2E (Playwright): `apps/web/e2e/stock-deposito-concurrencia.e2e.ts` (20 salidas de 1 sobre disponible 10 → 10
  aceptadas), `stock-traslado-concurrencia.e2e.ts` (10 traslados de 1 sobre disponible 5 → 5 aceptados),
  `stock-reservas-concurrencia.e2e.ts` (8 reservas de 1 sobre disponible 5 → 5 aceptadas) y
  `stock-depositos-reservas.e2e.ts` (recorrido de cierre: 2.º depósito → entrada 10 → traslado 4 → reserva 3 →
  disponible 7 → descuento con cantidad 7 y reservado 0).

## Contratos que cambian (alto riesgo)

1. `public.registrar_movimiento_stock` pasa de 6 a 7 parámetros (`p_deposito uuid default null` al final).
2. `public.listar_movimientos_stock` cambia su tipo de retorno (agrega `deposito_id`, `deposito_nombre` y
   `traslado_id`).
3. `public.stock_estados` cambia su tipo de retorno (agrega `reservado` y `disponible`) y el cálculo de `estado`.
4. La carga de `stock.actualizado` suma `deposito_id`, `reservado` y `disponible`, y `tipo_movimiento` admite
   `reserva` y `liberacion`.
5. Los movimientos con `traslado_id` dejan de emitir `stock.actualizado`.

Los tres primeros cambian el tipo de retorno: la migración hace `drop` de la firma anterior y `create` de la nueva,
así que no quedan dos sobrecargas ambiguas en PostgREST.

## Reversión

En orden, en migraciones posteriores y exportando antes los datos (el libro y las reservas son de solo agregado):

1. `20261023130400`: `drop trigger movimientos_stock_motivo_traslado on dominio.movimientos_stock` y
   `drop function private.validar_motivo_traslado()`.
2. `20261023130300`: `drop trigger reservas_stock_evento_alta, reservas_stock_evento_liberacion` y
   `drop function private.emitir_stock_reserva()`.
3. `20261023130200`: restaurar los cuerpos de `private.disponibilidad_producto` y `private.productos_con_stock` de
   `20261022120900_catalogo_disponibilidad.sql`.
4. `20261023130100`: liberar las reservas activas y `drop function public.reservar_stock(uuid, uuid, integer, text)`,
   `public.liberar_reserva(uuid)`, `public.descontar_reserva(uuid)` y `drop table dominio.reservas_stock`. Los motivos
   de sistema son dato: «Entrega de producto a pedido» se desactiva (no se borra) si ya tiene movimientos.
5. `20261023130000`: restaurar `private.emitir_stock_actualizado` de `20261023120300_stock_evento_deposito.sql` y
   `public.listar_movimientos_stock` de `20261023120400_stock_lecturas_deposito.sql`; `drop function
   public.trasladar_stock(uuid, uuid, uuid, integer, text, date)`; `alter table dominio.movimientos_stock drop column
   traslado_id`.
6. `20261023120500`: volver a la definición de `anular_ingreso_mercaderia` de `20261021180300`.
7. `20261023120400`: `drop view public.depositos_listado, public.stock_por_deposito` y restaurar `stock_estados` y
   `listar_movimientos_stock`.
8. `20261023120300`: restaurar `private.emitir_stock_actualizado` de `20261018180100_stock_evento_actualizado.sql`.
9. `20261023120200`: restaurar `registrar_movimiento_stock` a la firma de 6 parámetros de `20261017140100` +
   `20261017170000` y `drop function private.aplicar_movimiento_deposito(...)`.
10. `20261023120100`: `drop function` de las cuatro RPC de depósitos y de las funciones `private` de apoyo.
11. `20261023120000`: `alter publication supabase_realtime drop table dominio.existencias_deposito`; `drop trigger
    organizaciones_sembrar_deposito_principal`; `drop table dominio.existencias_deposito, dominio.depositos_empresas,
    dominio.depositos`; `alter table dominio.existencias drop column reservado` y `alter table
    dominio.movimientos_stock drop column deposito_id` (restaurando antes `registrar_movimiento_stock`).

Los comandos exactos están en el encabezado de cada migración.
