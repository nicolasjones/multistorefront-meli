---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · comprobantes (técnico, MSF-159)

Implementación de la épica **MSF-159** (spec `20261023-100000-ventas-comprobantes`): cabecera de factura y
presupuesto (**F-VTA-05**, MSF-273), líneas (**F-VTA-06**, MSF-295), confirmación con stock (**F-VTA-07**,
MSF-317) y presupuestos (**F-VTA-08**, MSF-331). La vista de producto está en
[Ventas · comprobantes](../producto/ventas-comprobantes.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-159-ventas-y-despacho-ventas-comprobantes`, **pendiente de merge a
    `main`**. Las migraciones citadas son `supabase/migrations/20261203100100` … `20261204150200`.

## Pantalla y rutas

- **Alta**: `/ventas/comprobantes/nuevo` (con `?tipo=presupuesto` abre un presupuesto).
- **Edición / consulta**: `/ventas/comprobantes/:id`.
- **Listado**: `/ventas/comprobantes` (MSF-177, ya entregado: búsqueda, filtros, tienda y exportación).
- **Presupuestos**: `/ventas/presupuestos` (menú **Ventas › Presupuestos**, icono `RequestQuoteIcon`, sección
  `ventas`); ver «Presupuestos (F-VTA-08)».
- Menú **Ventas** (`ReceiptLongIcon`), audiencia por la sección `ventas`; sin la sección, la ruta muestra
  «Acceso restringido`.
- La **Tienda** se preselecciona con la empresa activa de la barra superior (Principio VIII). En un
  comprobante nuevo se puede cambiar antes de guardar; una vez guardado queda bloqueada porque el
  comprobante pertenece a una sola tienda. Si la barra cambia de empresa con un comprobante abierto, la
  pantalla se cierra con aviso: nunca se muestran ni se guardan datos de una tienda bajo otra.
- **Canal de venta**: Mostrador, Tienda online y Teléfono/WhatsApp. Mercado Libre queda para la Etapa 2
  (no es un valor válido en la base).
- **Cliente**: buscador de Clientes + «Consumidor final». CUIT / DNI y dirección de entrega se muestran en
  lectura. La condición frente al IVA se muestra como «—»: todavía no se registra en la ficha del cliente.
- Estados: factura `borrador` → `confirmada` (F-VTA-07); presupuesto `pendiente` → `aceptado` (F-VTA-08).
  Solo se editan `borrador` y `pendiente`.

### Líneas (F-VTA-06)

- Se agregan con **Agregar producto** (buscador del catálogo por nombre o SKU, FR-012). La línea muestra
  Producto (nombre + código), Stock, Depósito de mercadería, Cantidad (− / + / número), Precio s/IVA y
  Subtotal (FR-019). El pie muestra **Subtotal sin IVA / IVA / Total** (FR-015).
- Cada línea elige **depósito de salida** con botones (`Local`, `Principal`, …) o lista si hay más de tres
  (FR-013). Sin elegir uno, la base usa el depósito principal de la organización.
- **Stock**: `Disp.` = existencias del depósito − reservado; `Res.` = reservado (FR-017). Si la cantidad
  supera el disponible se muestra el aviso de faltante, que **no impide guardar el borrador** (FR-018). Los
  productos «A pedido» muestran «A pedido · no descuenta stock» y no tienen disponible.
- El **precio y la escala** (x1/x5/x10/x50) los calcula la base con `private.precio_para` según el tipo de
  cliente y la cantidad de la línea (FR-014): minorista siempre x1; mayorista x1 (1-4), x5 (5-9), x10
  (10-49) y x50 (50 o más). Cambiar cantidad, depósito o cliente reenvía las líneas y se relee el
  comprobante. La regla de escala vive solo en `private.escala_para_linea` (*Decisiones abiertas* 8).
- **Precio manual** (FR-016): con la acción `editar_precio` de Ventas el precio es editable; la RPC lo
  vuelve a verificar y marca la línea. Sin la acción, el precio es de solo lectura (se puede re-guardar un
  precio manual ya guardado sin cambiarlo).
- `guardar_lineas_comprobante` **reemplaza todas las líneas** en una transacción y recalcula los totales del
  comprobante. Se envía con el `updated_at` vigente; mientras guarda, los controles quedan bloqueados. Un
  rechazo no deja líneas a medias.

### Presupuestos (F-VTA-08)

- **Listado** (`PresupuestosList`, `design/pantallas/VentasPresupuestos.dc.html`): Presupuesto, Tienda,
  Fecha, Cliente, Operador, Válido hasta, Estado, Total y Acciones, paginado (25), con «Buscar por cliente o
  número» (espera a que se deje de tipear), píldoras de estado (Todos, Pendiente, Aceptado, Vencido,
  Convertido en factura) y el filtro de tienda (`FiltroEmpresa`): por defecto **todas**; la empresa activa de
  la barra superior lo acota y al cambiarla la pantalla se remonta (página 1, búsqueda limpia, todo
  recargado). «Sin resultados» cuando el filtro no devuelve nada.
- **Estados**: `pendiente` → `aceptado`. **`vencido` se deriva** (no se guarda ni hay job): un `pendiente`
  con `valido_hasta` anterior a hoy (hoy en America/Argentina/Buenos_Aires, `private.hoy_argentina`). Un
  vencido no se acepta ni se modifica. `Convertido en factura` existe como filtro pero no tiene filas hasta
  que se decida la conversión (*Decisiones abiertas* 2).
- **Acciones por fila** (solo con `ventas` en edición en la tienda del presupuesto): **Aceptar** y
  **Modificar** solo en `pendiente` (deshabilitados en aceptado/vencido); **Copiar** en cualquier estado, que
  es la forma de renovar un vencido o repetir uno aceptado. Modificar abre `/ventas/comprobantes/:id`.
  «Nuevo presupuesto» abre el alta con `?tipo=presupuesto`. La pantalla del presupuesto también tiene
  «Copiar».
- **Aceptar** no reserva ni descuenta stock (FR-033/FR-050) y registra `presupuesto.aceptado`.
- **Copiar** crea un presupuesto `pendiente` con número nuevo en la misma tienda, mismo cliente, canal, forma
  de pago y envío, fecha de hoy y el operador que copia. `valido_hasta` conserva la **duración** del original
  contada desde hoy. Las líneas se recalculan con la lista vigente (`private.precio_para`) **salvo precio
  manual**, que se conserva. El depósito se conserva si la tienda aún vende desde él; si no, va el principal.
  Un producto que ya no está activo detiene la copia con un mensaje que lo nombra. El original no cambia.
  Registra `presupuesto.copiado`.
- Fuera de alcance (matriz de la spec): Exportar, Enviar por correo, Imprimir, Facturar, las demás pestañas
  de Ventas y el aviso de conversión a factura. Por eso el subtítulo dice «Se pueden copiar y modificar».

## Modelo de datos

Esquema (Principio VII):

| Tabla | Esquema | Naturaleza |
|---|---|---|
| `dominio.comprobantes_venta` (existente, se altera de forma aditiva) | `dominio` | Documento de venta: entidad de negocio del producto. |
| `dominio.comprobantes_venta_numeracion` (nueva) | `dominio` | Contador correlativo del documento de venta. |
| `dominio.comprobantes_venta_lineas` (nueva, F-VTA-06) | `dominio` | Detalle de venta: copia del producto, cantidad, precio sin IVA, escala, IVA, depósito y «A pedido». |
| `public.permisos_rol_accion` (existente; F-VTA-06 agrega el dato `editar_precio`) | `public` | Mecanismo de acceso transversal. |

Columnas agregadas a `dominio.comprobantes_venta` (`20261203100100_comprobantes_cabecera.sql`):

- `empresa_id` (uuid, FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas`; nulable para no
  romper las filas del contrato de F-CLI-08).
- `canal` (`mostrador` | `tienda_online` | `telefono_whatsapp`), `operador_id` (`auth.users`),
  `valido_hasta` (solo presupuestos, no anterior a `fecha`).
- `forma_pago_id` y `envio_id`: **solo la elección** (FR-005). Los catálogos son de MSF-139
  ([Ventas · catálogos](ventas-catalogos.md)): las tablas `formas_pago`, `formas_envio`,
  `cuentas_cobro` y `transportes` se construyen en esa rama, pero desde el comprobante no se declara FK
  y las RPC rechazan ids sueltos. La pantalla de MSF-159 todavía no ofrece la elección.
- `confirmado_en` / `confirmado_por` (los completa F-VTA-07), `updated_at` (bloqueo optimista) y
  `numero_entero` (el correlativo separado del texto visible, para cambiar el formato sin migrar datos).

**Contrato de `updated_at`:** no hay trigger que lo avance; solo `guardar_comprobante` lo hace (con
`clock_timestamp()`). Toda RPC posterior que modifique un comprobante (F-VTA-06 líneas, F-VTA-07
confirmación, anulación) DEBE avanzarlo en su `update`, o el bloqueo optimista no detectará su cambio.

`dominio.comprobantes_venta_lineas` (`20261203200100_comprobantes_lineas.sql`) guarda por línea:
`producto_id` y una copia de `descripcion`/`codigo`, `cantidad` (entero > 0), `precio_unitario` sin IVA,
`escala` (`x1`/`x5`/`x10`/`x50`), `precio_manual`, `alicuota_id`/`alicuota_porcentaje`, `deposito_id`,
`a_pedido`, `subtotal_sin_iva` e `iva`. FKs compuestas al comprobante, al producto y al depósito por
`organizacion_id`; índice único `(comprobante_id, orden)`.

RLS vigente en el comprobante y en las líneas: `select` por organización y sección `ventas`
(`lectura`/`edicion`). **Sin** políticas ni grants de escritura directa: se escribe solo por las RPC
`security definer`. `anon` sin acceso.

El modelo completo y el DER están en [Datos y DER](datos.md#ventas-comprobantes-msf-159).

## Numeración

`dominio.comprobantes_venta_numeracion` guarda `(organizacion_id, empresa_id, tipo) → ultimo`. RLS activa y
sin políticas ni grants: nadie la lee ni la escribe directo, solo `private.siguiente_numero_comprobante`.

La función hace un único `insert ... on conflict do update` que toma el bloqueo de la fila del contador:
dos altas simultáneas se serializan y reciben números distintos y consecutivos. El contador vive en la
misma transacción que el alta, así que un alta revertida no deja saltos. El índice único
`(organizacion_id, empresa_id, tipo, numero)` (parcial, solo filas con empresa) es la última defensa contra
duplicados.

Formato provisorio: correlativo de 8 dígitos (`00000001`) por organización, empresa y tipo
(*Decisiones abiertas* 1 de la spec). Cambiarlo es cambiar el formateo, no los datos.

## RPC

Todas en `public`, `security definer`, `search_path = ''`, `revoke execute ... from public, anon` y
`grant execute ... to authenticated`. La organización y el actor salen de la sesión; la sección `ventas`
se evalúa **en la empresa del comprobante** (no solo en la activa).

| RPC | Qué hace |
|---|---|
| `crear_comprobante(p_tipo, p_empresa_id, p_cliente_id, p_canal, p_fecha, p_valido_hasta, p_forma_pago_id, p_envio_id)` | Crea la factura (`borrador`) o el presupuesto (`pendiente`) numerado. Exige `ventas` en `edicion` en la empresa. |
| `guardar_comprobante(p_id, p_cliente_id, p_canal, p_fecha, p_valido_hasta, p_forma_pago_id, p_envio_id, p_actualizado_en)` | Edita la cabecera con bloqueo optimista. Rechaza documentos cerrados; la empresa y el tipo no son argumentos, así que no cambian. |
| `guardar_lineas_comprobante(p_id, p_lineas, p_actualizado_en)` | **F-VTA-06.** Reemplaza las líneas en una transacción: valida producto/depósito de la organización y activos, cantidad > 0; calcula precio y escala con `private.precio_para`, IVA por categoría u override; acepta `precio_manual` solo si el rol del usuario **en la tienda del comprobante** tiene `editar_precio` (`private.puede_editar_precio_en_empresa`, no la suma de sus roles); exige que el depósito venda para esa tienda (`depositos_empresas`, «Venden desde acá»; el principal por defecto se filtra igual); recalcula subtotal, IVA y total. Exige `ventas` en `edicion`. |
| `disponible_para_venta(p_producto_id, p_deposito_id)` | **F-VTA-06.** Stock vendible = existencias del depósito − reservado. Solo lectura (`lectura`/`edicion`); `null` si el producto o el depósito no son de la organización. |
| `confirmar_comprobante(p_id)` | **F-VTA-07.** Confirma una `factura` en `borrador` con ≥ 1 línea (ver «Confirmación y stock»). Idempotente. Exige `ventas` en `edicion` en la empresa del comprobante. |
| `aceptar_presupuesto(p_id)` | **F-VTA-08.** `pendiente` → `aceptado`, idempotente (reintentar no duplica el evento). Rechaza un vencido o un estado que no admite aceptar (`55000`). Exige `ventas` en `edicion` en la tienda. No toca stock. |
| `copiar_presupuesto(p_id)` | **F-VTA-08.** Crea el presupuesto nuevo descrito arriba. Lee el original con `for share`. Exige `edicion` en la tienda. Las líneas de precio manual conservan su precio sin volver a exigir `editar_precio` a quien copia (decisión vigente; pendiente de confirmar con negocio). Si el cliente ya no existe falla con `22023` y un mensaje propio (la FK de `comprobantes_venta` hoy impide borrarlo; es una guarda defensiva). |
| `listar_presupuestos(p_busqueda, p_estado, p_empresa_id, p_pagina, p_tamano)` | **F-VTA-08.** Lectura paginada (tope 200 por página): id, número, empresa, fecha, cliente, operador, válido hasta, estado (con `vencido` derivado), total, `puede_editar` y `filas` (total del filtro). Solo tiendas con `ventas` en `lectura` o `edicion`; una tienda ajena devuelve cero filas. `p_estado` ∈ pendiente · aceptado · vencido · convertido (otro valor: `22023`). |
| `obtener_comprobante(p_id)` | Cabecera + cliente + operador + líneas (con depósito, stock y reservado) + totales + `puede_editar_precio`; exige `lectura` o `edicion`. |

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` no existe · `55000` documento
cerrado · `40001` conflicto de edición · `P0001` con `hint = 'stock'` sin stock suficiente al confirmar
(otro P0001 es un error interno; el front no lo toma por faltante). El mensaje nombra producto y depósito.
`apps/web/src/lib/ventas.ts` los traduce a mensajes en castellano.

## Confirmación y stock (F-VTA-07)

`confirmar_comprobante` corre en **una transacción**: toma el comprobante `for update`, valida y recorre las
líneas por (producto, depósito) para tomar siempre los bloqueos en el mismo orden.

- **Solo `factura` en `borrador` con al menos una línea.** Un presupuesto nunca se confirma ni mueve stock
  (alta, aceptación, copia y modificación tampoco: FR-033).
- **Línea de stock → salida** del depósito de esa línea por su cantidad (motivo de sistema «Venta de
  factura», nota «Factura <número>»).
- **Línea «A pedido» → reserva activa** en su depósito, **sin descontar**, con
  `referencia = 'comprobante:<id>:linea:<orden>'`. El descuento ocurre al marcar el comprobante como
  **Entregado**, que es de MSF-135 (`descontar_reserva`): esta historia solo deja la reserva con la
  referencia necesaria.
- **Todo o nada.** Si algún depósito no tiene disponible (existencias − reservado) suficiente, falla con
  `P0001` («No hay stock suficiente de <producto> en el depósito <depósito>: hay N y la factura pide M») y
  no queda ningún movimiento parcial. Dos confirmaciones simultáneas se serializan (comprobante y
  existencias `for update`): sin stock negativo ni doble descuento.
- **Idempotente.** Reintentar sobre una `confirmada` devuelve el comprobante sin tocar el stock ni repetir
  el evento.
- Pasa a `confirmada`, fija `confirmado_en`/`confirmado_por` y registra `comprobante.confirmado`.
- **Motor de stock.** Usa `private.aplicar_movimiento_deposito` (la misma rutina de
  `registrar_movimiento_stock`, `reservar_stock` y `descontar_reserva`), no sus RPC públicas: esas exigen
  `stock` en `edicion`, y quien vende confirma con `ventas` en `edicion` en la tienda. La autoridad es el
  permiso de ventas de la empresa.
- **Ranking de clientes.** `private.comprobante_cuenta_como_facturado` pasa a contar solo facturas que no
  están en `borrador` ni `anulada` (FR-036); una factura sin confirmar ya no suma (migración
  `20261204140100_facturado_sin_borradores.sql`).
- **Pantalla.** El botón «Confirmar factura» aparece en una factura en borrador, editable y con líneas;
  abre un diálogo de confirmación que lista los faltantes visibles (y no deja confirmar mientras los haya),
  muestra el error de stock sin cerrarse y, al confirmar, recarga el comprobante en solo lectura.
- **Divergencia prototipo/épica.** El prototipo reserva al crear y descuenta al «Entregado»; la épica
  manda: la factura **descuenta al confirmar** y solo «A pedido» reserva y descuenta al entregar. La acción
  «Confirmar factura» no está en el prototipo (FR-037).

## Actividad

Aceptar y copiar registran `presupuesto.aceptado` / `presupuesto.copiado` (F-VTA-08). Cada alta, edición y
confirmación registran `comprobante.creado` / `comprobante.editado` / `comprobante.confirmado` con
`private.registrar_actividad`, en la misma transacción que la escritura, asociados a la tienda del
comprobante (FR-008).

## Permisos

- Sin la sección `ventas`: «Acceso restringido» (no se llega a la pantalla).
- `lectura`: se ve el comprobante; no hay «Guardar cambios» ni alta.
- `edicion` en la empresa del comprobante: alta y edición (cabecera y líneas) mientras el documento sea
  editable.
- **`editar_precio`** (`permisos_rol_accion`, sección `ventas`; F-VTA-06): sembrada para Administrador y
  Operador; exige nivel `edicion` en Ventas. La verifica la RPC, no solo la pantalla. La matriz de Roles
  todavía no muestra esta acción: se configura como dato y queda para la pantalla de Roles.
- **Alcance de lectura (decisión de F-VTA-06):** la policy `select` de `comprobantes_venta_lineas` y
  `private.disponible_para_venta` filtran por organización y `nivel_seccion('ventas')` global, igual que la
  cabecera: quien tiene `ventas` ve las líneas y el stock de depósitos de todas las tiendas de su
  organización. Es intencional; las escrituras (RPC) sí exigen nivel por empresa y depósito de esa empresa.
- `private.precio_para` acepta `empresas` **o** `ventas` (lectura o edición); un rol con ninguna de las dos
  recibe vacío (cubierto en `precios_escala.test.sql`).
- `editar_precio` es un permiso sin pantalla de gestión por ahora: su valor queda fijo (sembrado) hasta que
  Roles lo exponga; mientras tanto solo se cambia en `permisos_rol_accion`.
- El Administrador de la organización accede a todas sus empresas; los demás, a las asignadas
  (`usuarios_empresas`).
- Los clientes son de **toda la organización**: `crear_comprobante` y `guardar_comprobante` validan que el
  cliente sea de la organización (y no esté archivado), no que esté habilitado en la tienda del comprobante
  (`clientes_empresas` solo filtra el listado de Clientes y no restringe la venta). Decisión de esta
  historia.
- El correlativo se muestra con `lpad(..., 8, '0')`: pasado 99.999.999 el texto `numero` se truncaría,
  pero `numero_entero` seguiría correcto. Límite teórico, sin acción.
- «Consumidor final» es un cliente minorista sembrado por organización por F-CLI-03
  (`20261016130300_clientes_tipo_y_consumidor_final.sql`): trigger sobre `organizaciones` + backfill
  idempotente. No se duplica en esta historia.

## Revisión de seguridad del cierre

Revisión de las migraciones de la épica (`20261203100100` … `20261204150200`) con foco en RLS,
`security definer`, permisos por empresa, `anon`, precio manual y concurrencia de stock. Resultado: **sin
hallazgos bloqueantes**.

- **RLS y `anon`:** `comprobantes_venta`, `comprobantes_venta_lineas` y `comprobantes_venta_numeracion` tienen
  RLS; `anon` y `public` sin privilegios; `authenticated` solo `select` en cabecera y líneas (la numeración,
  ni eso). Toda escritura pasa por RPC.
- **RPC:** todas las `public.*` de la épica (`crear_`/`guardar_`/`obtener_comprobante`,
  `guardar_lineas_comprobante`, `confirmar_comprobante`, `aceptar_`/`copiar_`/`listar_presupuestos`,
  `disponible_para_venta`) son `security definer` con `search_path = ''`, `revoke ... from public, anon` y
  `grant execute ... to authenticated` explícitos. Las `private.*` de apoyo (`nivel_ventas_en_empresa`,
  `puede_editar_precio_en_empresa`, `siguiente_numero_comprobante`, `hoy_argentina`) no son ejecutables por
  `anon` ni `authenticated`.
- **Organización y actor:** salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un
  argumento. Escribir exige `ventas` en `edicion` **en la empresa del comprobante**
  (`nivel_ventas_en_empresa`).
- **Precio manual:** `precio_manual` exige `editar_precio` resuelto con el rol del usuario en ESA empresa; el
  precio base lo calcula `private.precio_para`, el cliente no lo envía.
- **Concurrencia de stock:** `confirmar_comprobante` toma `for update` del comprobante (la segunda
  confirmación espera y ve `confirmada`: idempotente) y procesa las líneas en orden fijo (producto, depósito,
  línea), de modo que dos facturas con los mismos productos toman los bloqueos de existencias en el mismo
  orden y no se bloquean entre sí. Un faltante revierte la transacción entera.
- **Residual aceptado:** la lectura directa (`select`) de cabecera y líneas filtra por organización y
  `nivel_seccion('ventas')`, no por empresa (ver «Alcance de lectura»). Las escrituras sí son por empresa.
- No se pudo ejecutar pgTAP localmente (sin acceso al daemon de Docker en este entorno): los tests de base de
  datos de la épica corren en el CI.

## Fuera de alcance (estas historias)

Exportar / correo / impresión / Facturar de Presupuestos, descuento de las reservas «A pedido» al entregar
(MSF-135), impresión y envío (MSF-213), cobro/conciliación y despacho, observaciones.
**MSF-177 ya entregó** el listado con filtros y exportación, los estados del comprobante y de cobro, el
historial, la anulación y la nota de crédito: ver
[Ventas · listado, estados y anulación (técnico)](ventas-listado-estados-y-anulacion.md).
Los catálogos de forma de pago y envío los entrega MSF-139 (ver [Ventas · catálogos](ventas-catalogos.md)); la base ya los acepta y los valida.

## Pruebas

- pgTAP: `supabase/tests/database/ventas_comprobantes_alta.test.sql`,
  `ventas_comprobantes_lineas.test.sql`, `ventas_confirmacion.test.sql`,
  `ventas_presupuestos.test.sql`.
- Vitest: `apps/web/src/pages/ventas/comprobante.test.tsx`,
  `apps/web/src/pages/ventas/presupuestos.test.tsx`, `apps/web/src/lib/ventasLineas.test.ts`,
  `apps/web/src/lib/ventasConfirmacion.test.ts` y los componentes de `apps/web/src/components/ventas/`.
- Guardia de versiones de migración: `scripts/migraciones-ventas-comprobantes.test.mjs`.

## Reversión

Las migraciones son **aditivas** y documentan su reversión en el encabezado:

1. `20261203100100_comprobantes_cabecera.sql`: quitar índices y columnas agregadas.
2. `20261203100200_comprobantes_numeracion.sql`: `drop function private.siguiente_numero_comprobante` y
   `drop table dominio.comprobantes_venta_numeracion`.
3. `20261203100400_comprobantes_rpc.sql`: `drop function` de `crear_comprobante`, `guardar_comprobante`,
   `obtener_comprobante` y de las funciones privadas de apoyo.
4. `20261203200100_comprobantes_lineas.sql`: `drop table dominio.comprobantes_venta_lineas` (exportar
   antes si hay líneas).
5. `20261203200200_accion_editar_precio.sql`: borrar las filas `editar_precio` de
   `public.permisos_rol_accion` y restaurar el check y las funciones `private.matriz_acciones_iniciales` y
   `private.puede_accion` anteriores.
6. `20261203200300_lineas_rpc.sql`: `drop function public.guardar_lineas_comprobante`,
   `private.escala_para_linea` y restaurar `public.obtener_comprobante` y `private.precio_para` anteriores.
7. `20261203200400_disponible_para_venta.sql`: `drop function public.disponible_para_venta`.
8. `20261204140000_confirmar_comprobante.sql`: `drop function public.confirmar_comprobante(uuid)`. Las
   confirmaciones ya hechas **no se deshacen solas** (movimientos de stock y reservas): se corrigen con el
   ajuste de stock o liberando la reserva. El motivo «Venta de factura» es dato (se desactiva, no se borra).
9. `20261204140100_facturado_sin_borradores.sql`: restaurar `private.comprobante_cuenta_como_facturado` con
   `p_tipo = 'factura' and p_estado <> 'anulada'`.
10. `20261204150000_aceptar_presupuesto.sql`: `drop function public.aceptar_presupuesto(uuid)` y
    `private.hoy_argentina()` (si ninguna otra función la usa).
11. `20261204150100_copiar_presupuesto.sql`: `drop function public.copiar_presupuesto(uuid)`.
12. `20261204150200_listar_presupuestos.sql`: `drop function public.listar_presupuestos(text, text, uuid,
    integer, integer)`.

Si Ventas ya escribió, exportar antes `dominio.comprobantes_venta` y su numeración: las columnas nuevas no
se borran en el mismo PR que las crea.
