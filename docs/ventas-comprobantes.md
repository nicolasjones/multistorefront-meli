---
owner: tecnico
sources:
  - specs/20261113-120000-precio-promocional-en-pos-y-comprobantes
  - apps/web/src/lib/ventas.ts
  - apps/web/src/pages/ventas/comprobante.tsx
  - supabase/migrations/20270507180200_aplicar_iva_al_centavo.sql
  - supabase/migrations/20270507170000_clientes_condicion_iva_via_de_carga.sql
  - supabase/migrations/20261016130300_clientes_tipo_y_consumidor_final.sql
  - supabase/migrations/20261203100100_comprobantes_cabecera.sql
  - supabase/migrations/20261203100200_comprobantes_numeracion.sql
  - supabase/migrations/20261203100400_comprobantes_rpc.sql
  - supabase/migrations/20261203200100_comprobantes_lineas.sql
  - supabase/migrations/20261203200200_accion_editar_precio.sql
---

# Ventas · Comprobantes

> **Guía de referencia de ingeniería.** Existe una versión reorganizada: [versión técnica](tecnico/ventas-comprobantes.md) · [guía de uso](producto/ventas-comprobantes.md). Esta página conserva el detalle de contratos, RPC, migraciones y decisiones que las otras versiones pueden no repetir; ante una diferencia, verificá contra el código y la spec.

Alta y edición de una factura o un presupuesto: la **cabecera** (F-VTA-05, MSF-273) y sus **líneas**
(F-VTA-06, MSF-295), su **confirmación** con descuento y reserva de stock (F-VTA-07, MSF-317) y los
**presupuestos**: listar, aceptar, copiar y modificar (F-VTA-08, MSF-331), de la épica MSF-159.

## Pantalla

- **Alta**: `/ventas/comprobantes/nuevo` (con `?tipo=presupuesto` abre un presupuesto).
- **Edición / consulta**: `/ventas/comprobantes/:id`.
- `/ventas/comprobantes` es el **listado** de facturas y notas (F-VTA-09, MSF-346); el alta sigue en
  `/ventas/comprobantes/nuevo`. `/ventas` redirige al listado. Ver [ventas-listado-comprobantes.md](ventas-listado-comprobantes.md).
- **Presupuestos**: `/ventas/presupuestos` (menú **Ventas › Presupuestos**, icono `RequestQuoteIcon`, sección
  `ventas`); ver «Presupuestos (F-VTA-08)».
- Menú **Ventas** (`ReceiptLongIcon`), audiencia por la sección `ventas`; sin la sección, la ruta muestra
  «Acceso restringido».
- La **Tienda** se preselecciona con la empresa activa de la barra superior (Principio VIII). En un
  comprobante nuevo se puede cambiar antes de guardar; una vez guardado queda bloqueada porque el
  comprobante pertenece a una sola tienda. Si la barra cambia de empresa con un comprobante abierto, la
  pantalla se cierra con aviso: nunca se muestran ni se guardan datos de una tienda bajo otra.
- **Canal de venta**: Mostrador, Tienda online y Teléfono/WhatsApp. Mercado Libre queda para la Etapa 2
  (no es un valor válido en la base).
- **Cliente**: buscador de Clientes + «Consumidor final». CUIT / DNI y dirección de entrega se muestran en
  lectura. La condición frente al IVA se muestra como «—»: todavía no se registra en la ficha del cliente. (La columna `dominio.clientes.condicion_iva` ya tiene vía de carga por API e importación desde `20270507170000`, pero ni la ficha ni esta pantalla la muestran todavía: `pages/ventas/comprobante.tsx`.)
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
- El **precio y la escala** (x1/x5/x10/x50) los calcula la base con `private.precio_linea_venta` (MSF-816: la función única de
  precio de línea, que usan `guardar_lineas_comprobante` y `copiar_presupuesto`; envoltorio con la compuerta de sesión de
  `private.precio_linea_venta_calculo`, MSF-176 B2, que a su vez usa `private.precio_para_calculo`) según el tipo de
  cliente y la cantidad de la línea (FR-014): minorista siempre x1; mayorista x1 (1-4), x5 (5-9), x10
  (10-49) y x50 (50 o más). Cambiar cantidad, depósito o cliente reenvía las líneas y se relee el
  comprobante. La regla de escala vive solo en `private.escala_para_linea` (*Decisiones abiertas* 8).
- **Nota del cliente en presupuestos de la tienda** (MSF-176): si el presupuesto lo pidió el cliente desde la tienda online, la pantalla muestra su nota en un campo «Nota del cliente» de solo lectura, complementario a la nota interna del comprobante.
- **Precio promocional** (MSF-816, F-2): una línea que cobró una promoción de la tienda del comprobante trae
  `precio_referencia` (el precio normal del cliente, con su escala y su descuento; nunca `promocion_id`). La celda de precio
  muestra el cobrado, el anterior **tachado** y la leyenda «Promoción», con «Precio anterior» y «Precio promocional» para
  lectores de pantalla; el rótulo de escala (`x10`) y el descuento se omiten y el rótulo pasa a «promoción». Un precio manual
  o una línea `sin_stock` nunca se ven en promoción. Los precios son los que el servidor guardó para la tienda DEL
  comprobante, no los de la empresa activa de la barra superior (FR-014). Componente compartido con el mostrador:
  `components/ventas/PrecioLineaPromocion.tsx`; helpers `lineaEnPromocion` y `rotuloEscalaLinea` en `lib/ventasLineas.ts`.
  Si al confirmar el servidor responde `40001` con `hint = 'precios_cambiaron'` (F-3), el diálogo «Confirmar factura»
  re-guarda las líneas (mismas cantidades y precios manuales) y avisa «Los precios cambiaron: revisá el total y confirmá de nuevo.»
  con el total nuevo; no reintenta solo. Si el re-guardado falla (conflicto de edición, error), el diálogo muestra «No pudimos
  actualizar los precios. Probá de nuevo.» y NO el aviso (diría un total viejo). El aviso vive en una región viva
  (`role="status"`) que ya estaba en el DOM, sin robar el foco.
- **Precio manual** (FR-016): con la acción `editar_precio` de Ventas el precio es editable; la RPC lo
  vuelve a verificar y marca la línea. Sin la acción, el precio es de solo lectura (se puede re-guardar un
  precio manual ya guardado sin cambiarlo).
- `guardar_lineas_comprobante` **reemplaza todas las líneas** en una transacción y recalcula los totales del
  comprobante. Se envía con el `updated_at` vigente; mientras guarda, los controles quedan bloqueados. Un
  rechazo no deja líneas a medias.

### Presupuestos (F-VTA-08)

- **Listado** (`PresupuestosList`, `VentasPresupuestos.dc.html`): Presupuesto, Tienda, Fecha, Cliente, Operador,
  Válido hasta, Estado, Total y Acciones, paginado (25), con «Buscar por cliente o número» (espera a que se
  deje de tipear), píldoras de estado (Todos, Pendiente, Aceptado, Vencido, Convertido en factura) y el
  filtro de tienda (`FiltroEmpresa`): por defecto **todas**; la empresa activa de la barra superior lo acota
  y al cambiarla la pantalla se remonta (página 1, búsqueda limpia, todo recargado). «Sin resultados» cuando
  el filtro no devuelve nada.
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
- Fuera de alcance (matriz de la spec): Enviar por correo, Imprimir, Facturar, las demás pestañas de Ventas y
  el aviso de conversión a factura. Por eso el subtítulo dice «Se pueden copiar y modificar».
- **Exportar** (F-VTA-09, FR-006/FR-010): exporta todos los presupuestos del filtro a CSV (hasta 10.000) o
  pide la exportación diferida por encima, igual que Comprobantes. Ver
  [ventas-listado-comprobantes.md](ventas-listado-comprobantes.md).

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
- `forma_pago_id` y `envio_id`: **solo la elección** (FR-005). Los catálogos son de MSF-139; mientras no
  existan en la base no se declara FK y las RPC rechazan ids sueltos.
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

**Origen y líneas sin stock (F-SVC-13, `20270201200128_comprobantes_origen.sql` y
`20270201200129_lineas_sin_stock.sql`)**: `dominio.comprobantes_venta` suma `origen_tipo` (`reparacion`) y
`origen_id` (solo los escribe la RPC `generar_comprobante_reparacion`; índice único parcial: un comprobante
vigente por origen) y `dominio.comprobantes_venta_lineas` suma `sin_stock`: la línea **no mueve stock** (ni
descuento, ni reserva, ni devolución al anular o emitir una nota de crédito) y por eso admite `producto_id`,
`deposito_id` y `escala` nulos. Editar las líneas de catálogo conserva las `sin_stock` y las suma a los totales;
en pantalla se ven en solo lectura, con la marca «No descuenta stock». `obtener_comprobante` expone el origen
(`origen_tipo`, `origen_id`, `origen_numero`) y la marca por línea, de forma aditiva. Detalle en
[service-cobro.md](service-cobro.md).

RLS vigente en el comprobante y en las líneas: `select` por organización, sección `ventas`
(`lectura`/`edicion`) y empresa accesible (las líneas la heredan del comprobante; un comprobante sin empresa sigue visible; MSF-656). **Sin** políticas ni grants de escritura directa: se escribe solo por las RPC
`security definer`. `anon` sin acceso.

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
| `copiar_presupuesto(p_id)` | **F-VTA-08.** Crea el presupuesto nuevo descrito arriba. Lee el original con `for share`. Exige `edicion` en la tienda. Las líneas de precio manual conservan su precio sin volver a exigir `editar_precio` a quien copia (decisión vigente; pendiente de confirmar con negocio). Si el cliente ya no existe falla con `22023` y un mensaje propio (la FK de `comprobantes_venta` hoy impide borrarlo; es una guarda defensiva). **Precio (MSF-933, S2)**: reprecia como el mostrador (`private.precio_linea_venta`): aplica el **descuento vigente del cliente** y la promoción de la tienda, gana el más bajo sin acumular, y guarda `descuento_pct` (0 si ganó la promoción o si el precio es manual). Antes copiaba a precio de lista sin el descuento (defecto del hallazgo 3). |
| `listar_presupuestos(p_busqueda, p_estado, p_empresa_id, p_pagina, p_tamano, p_origen)` | **F-VTA-08.** Lectura paginada (tope 200 por página): id, número, empresa, fecha, cliente, operador, válido hasta, estado (con `vencido` derivado), total, `puede_editar` y `filas` (total del filtro). Solo tiendas con `ventas` en `lectura` o `edicion`; una tienda ajena devuelve cero filas. `p_estado` ∈ pendiente · aceptado · vencido · convertido (otro valor: `22023`). `p_origen` (MSF-942, por defecto `null` = todos) ∈ `panel` · `tienda` (según el vínculo `dominio.presupuestos_tienda`; otro valor: `22023`): filtra antes de contar y paginar, así `filas` y las tandas son del canal elegido. |
| `obtener_comprobante(p_id)` | Cabecera + cliente + operador + líneas (con depósito, stock y reservado) + totales + `puede_editar_precio`; exige `lectura` o `edicion`. |

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` no existe · `55000` documento
cerrado · `40001` conflicto de edición · `P0001` con `hint = 'stock'` sin stock suficiente al confirmar (otro P0001 es un error interno; el front no lo toma por faltante) (el mensaje nombra producto y
depósito). `apps/web/src/lib/ventas.ts` los traduce a mensajes en castellano.

## Confirmación y stock (F-VTA-07)

`confirmar_comprobante` corre en **una transacción**: toma el comprobante `for update`, valida y recorre las líneas
por (producto, depósito) para tomar siempre los bloqueos en el mismo orden.

- **Solo `factura` en `borrador` con al menos una línea.** Un presupuesto nunca se confirma ni mueve stock
  (alta, aceptación, copia y modificación tampoco: FR-033).
- **Línea de stock → salida** del depósito de esa línea por su cantidad (motivo de sistema «Venta de factura»,
  nota «Factura <número>»).
- **Línea «A pedido» → reserva activa** en su depósito, **sin descontar**, con
  `referencia = 'comprobante:<id>:linea:<orden>'`. El descuento ocurre al marcar el comprobante como
  **Entregado**, que es de MSF-135 (`descontar_reserva`): esta historia solo deja la reserva con la
  referencia necesaria.
- **Todo o nada.** Si algún depósito no tiene disponible (existencias − reservado) suficiente, falla con
  `P0001` («No hay stock suficiente de <producto> en el depósito <depósito>: hay N y la factura pide M») y no queda ningún
  movimiento parcial. Dos confirmaciones simultáneas se serializan (comprobante y existencias `for update`):
  sin stock negativo ni doble descuento.
- **Idempotente.** Reintentar sobre una `confirmada` devuelve el comprobante sin tocar el stock ni repetir el evento.
- Pasa a `confirmada`, fija `confirmado_en`/`confirmado_por` y registra `comprobante.confirmado`.
- **Motor de stock.** Usa `private.aplicar_movimiento_deposito` (la misma rutina de `registrar_movimiento_stock`,
  `reservar_stock` y `descontar_reserva`), no sus RPC públicas: esas exigen `stock` en `edicion`, y quien
  vende confirma con `ventas` en `edicion` en la tienda. La autoridad es el permiso de ventas de la empresa.
- **Ranking de clientes.** `private.comprobante_cuenta_como_facturado` pasa a contar solo facturas que no están en
  `borrador` ni `anulada` (FR-036); una factura sin confirmar ya no suma (migración
  `20261204140100_facturado_sin_borradores.sql`).
- **Pantalla.** El botón «Confirmar factura» aparece en una factura en borrador, editable y con líneas; abre un
  diálogo de confirmación que lista los faltantes visibles (y no deja confirmar mientras los haya), muestra el
  error de stock sin cerrarse y, al confirmar, recarga el comprobante en solo lectura.
- **Divergencia prototipo/épica.** El prototipo reserva al crear y descuenta al «Entregado»; la épica manda: la
  factura **descuenta al confirmar** y solo «A pedido» reserva y descuenta al entregar. La acción «Confirmar
  factura» no está en el prototipo (FR-037).

## Actividad

Aceptar y copiar registran `presupuesto.aceptado` / `presupuesto.copiado` (F-VTA-08). Cada alta, edición y confirmación registran `comprobante.creado` / `comprobante.editado` /
`comprobante.confirmado` con
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
- **Alcance de lectura (decisión de F-VTA-06):** la policy `select` de `comprobantes_lineas` y
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
  (`clientes_empresas` solo filtra el listado de Clientes y no restringe la venta). Decisión de esta historia.
- El correlativo se muestra con `lpad(..., 8, '0')`: pasado 99.999.999 el texto `numero` se truncaría,
  pero `numero_entero` seguiría correcto. Límite teórico, sin acción.
- «Consumidor final» es un cliente minorista sembrado por organización por F-CLI-03
  (`20261016130300_clientes_tipo_y_consumidor_final.sql`): trigger sobre `organizaciones` + backfill
  idempotente. No se duplica en esta historia.

## Revisión de seguridad del cierre (T039)

Revisión de las migraciones de la épica (`20261203100100` … `20261204150200`) con foco en RLS, `security definer`,
permisos por empresa, `anon`, precio manual y concurrencia de stock. Resultado: **sin hallazgos bloqueantes**.

- **RLS y `anon`:** `comprobantes_venta`, `comprobantes_venta_lineas` y `comprobantes_venta_numeracion` tienen RLS;
  `anon` y `public` sin privilegios; `authenticated` solo `select` en cabecera y líneas (la numeración, ni eso).
  Toda escritura pasa por RPC.
- **RPC:** todas las `public.*` de la épica (`crear_`/`guardar_`/`obtener_comprobante`, `guardar_lineas_comprobante`,
  `confirmar_comprobante`, `aceptar_`/`copiar_`/`listar_presupuestos`, `disponible_para_venta`) son
  `security definer` con `search_path = ''`, `revoke ... from public, anon` y `grant execute ... to authenticated`
  explícitos. Las `private.*` de apoyo (`nivel_ventas_en_empresa`, `puede_editar_precio_en_empresa`,
  `siguiente_numero_comprobante`, `hoy_argentina`) no son ejecutables por `anon` ni `authenticated`.
- **Organización y actor:** salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento.
  Escribir exige `ventas` en `edicion` **en la empresa del comprobante** (`nivel_ventas_en_empresa`).
- **Precio manual:** `precio_manual` exige `editar_precio` resuelto con el rol del usuario en ESA empresa; el
  precio base lo calcula `private.precio_para`, el cliente no lo envía.
- **Concurrencia de stock:** `confirmar_comprobante` toma `for update` del comprobante (la segunda confirmación espera
  y ve `confirmada`: idempotente) y procesa las líneas en orden fijo (producto, depósito, línea), de modo que dos
  facturas con los mismos productos toman los bloqueos de existencias en el mismo orden y no se bloquean entre sí.
  Un faltante revierte la transacción entera.
- **Residual aceptado:** la lectura directa (`select`) de cabecera y líneas filtra por organización y
  `nivel_seccion('ventas')`, no por empresa (ver «Alcance de lectura»). Las escrituras sí son por empresa.
- No se pudo ejecutar pgTAP localmente (sin acceso al daemon de Docker en este entorno): los tests de base de datos
  de la épica corren en el CI.

## Fuera de alcance (estas historias)

Correo / impresión / Facturar de Presupuestos, descuento de las reservas «A pedido» al entregar (MSF-135),
anulación y notas de crédito (F-VTA-11, MSF-177), impresión y envío (MSF-213), cobro/conciliación, despacho,
observaciones e historial de estados. El listado y la exportación de Comprobantes y Presupuestos son de F-VTA-09. La elección de forma de pago y envío en pantalla espera los catálogos
de MSF-139; la base ya los acepta y los valida cuando existan.

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

8. `20261204150000_aceptar_presupuesto.sql`: `drop function public.aceptar_presupuesto(uuid)` y
   `private.hoy_argentina()` (si ninguna otra función la usa).
9. `20261204150100_copiar_presupuesto.sql`: `drop function public.copiar_presupuesto(uuid)`.
10. `20261204150200_listar_presupuestos.sql`: `drop function public.listar_presupuestos(text, text, uuid, integer, integer)`.

Si Ventas ya escribió, exportar antes `dominio.comprobantes_venta` y su numeración: las columnas nuevas no
se borran en el mismo PR que las crea.

- Guardia de versiones: `scripts/migraciones-ventas-comprobantes.test.mjs` (en `pnpm test:tooling`) verifica versiones únicas de 14 dígitos, posteriores a `origin/dokploy`, y que esta doc cite solo migraciones existentes.

## Precios especiales por cliente (F-VTA-32, MSF-340 · épica MSF-193)

`guardar_lineas_comprobante` (misma firma y retorno, sin `BREAKING`) calcula el precio de cada línea como
`round(neto de escala * (1 - descuento / 100), 2)`, **antes del IVA**. El descuento sale de `dominio.clientes.descuento`
del cliente del comprobante, leído en el servidor: el payload no puede imponerlo (una clave `descuento` se ignora).
Un `precio_manual` no se descuenta. La línea guarda `dominio.comprobantes_venta_lineas.descuento_pct` (columna
aditiva, `0` si no hubo descuento o el precio es manual) para mostrarlo y para que lo ya vendido no cambie si luego
cambia la ficha; `obtener_comprobante` lo devuelve por línea y la tabla de líneas rotula
«escala x10 · 5 % de descuento». Migración `20270201200103_lineas_descuento.sql` (reversión en su encabezado).
«Lista propia» por cliente queda fuera de alcance (spec, *Decisiones abiertas* 1).

## Correcciones de UI funcional (épica MSF-585)

Tanda de correcciones solo de frontend, un commit por defecto para poder revertirlos por separado:

- **MSF-614** — la orden de ingreso de una reparación no imprime texto provisional: sin condiciones definidas
  (`CONDICIONES_SERVICIO`) la línea se omite.
- **MSF-627** — Productos: «Desactivar» pide confirmación; «Activar» sigue siendo directo.
- **MSF-628** — abrir una nota de crédito directo titula «Nota de crédito NNNNNNNN» (antes «undefined»). Su estado se
  muestra como lo guarda la base (`confirmada`, rotulado «Pendiente»), igual que en el listado.
- **MSF-629** — las etiquetas de los selectores vacíos (Armó, Controló, Entregó, Transporte) quedan arriba del campo y
  las columnas Precio s/IVA y Subtotal de las líneas son más anchas para importes grandes.
- **MSF-623** — el conteo de productos de una categoría raíz de la tienda (pública y «Catálogo visible») suma el de sus
  subcategorías (`acumularConteoCategorias`) solo en el panel (`listar_catalogo_tienda` cuenta los directos); la tienda pública NO lo suma de nuevo porque `publico.categorias_por_dominio` ya acumula (corregido en el lote 41: contaba el doble).

Quedaron sin corregir, por necesitar una decisión o un cambio de base: **MSF-609** (las RPC de documentos, envío,
responsables y faltantes exigen el estado `confirmada`) y **MSF-615** (la base permite anular y editar datos de una
reparación entregada: es una decisión de negocio).

## Precio promocional en el servidor (MSF-816 · F-1)

`private.precio_linea_venta` es la **única** función de precio de línea: envuelve `private.precio_para` y `private.escala_para_linea` (sin modificarlos) y aplica **«gana el más bajo, sin acumular»** entre el precio normal de la línea (escala o precio propio o lista, **menos** el descuento del cliente) y la promoción vigente de la **tienda del comprobante** (`desde <= instante < hasta`, no anulada, solo con la bandera `promociones_precio` encendida). Una promoción mayor o igual al normal se ignora; si gana la promoción, la línea guarda `precio_referencia` (el precio normal del cliente, el «tachado»), `promocion_id` y `descuento_pct = 0`. El `precio_manual` manda siempre y no lleva referencia. La promoción la lee `private.promocion_vigente_fila` (`security definer`, filtra por organización, tienda y producto; sin `execute` para `anon`/`authenticated`).

- `guardar_lineas_comprobante` y `copiar_presupuesto` (esta última con el descuento del cliente desde S2 = MSF-933, como el mostrador) usan la función con `clock_timestamp()` tomado después del bloqueo del comprobante. Las claves `precio_referencia`/`promocion_id` dentro de `p_lineas` se ignoran.
- `obtener_comprobante` devuelve `precio_referencia` por línea (`null` sin promoción) y **no** `promocion_id`.
- **Listas de precios (F-CLI-21, `20270348000000` a `20270348000200`).** `precio_linea_venta` recibe además el cliente del comprobante y, **con la bandera `listas_precios` encendida**, el precio normal de la línea sale de la lista del cliente cuando no rigen un precio manual, una escala cargada ni un precio propio; en esa línea el descuento personal no se aplica y la promoción gana solo si es estrictamente menor. Cada línea guarda `lista_precio_id` y `lista_ajuste_pct` (snapshot; las notas de crédito lo heredan y `copiar_presupuesto` lo vuelve a calcular). `obtener_comprobante` devuelve por línea `lista_ajuste_pct` y `lista_nombre` (`null` sin lista; **no** devuelve `lista_precio_id`) para la marca «Lista: nombre ±n %». La guarda de la confirmación (`lineas_con_promocion_desactualizada`) también compara el snapshot de la lista contra el motor: cambio de porcentaje, lista reasignada o quitada o bandera apagada entre guardar y confirmar dan `40001` (`precios_cambiaron`); otros cambios del precio normal (ajuste de tienda, escalas) siguen sin detectarse (MSF-970). Una línea que la lista lleva a $0 se rechaza (`22023`) salvo precio manual. Con la bandera apagada el resultado es idéntico al de antes. Detalle en [Precios](precios.md#como-se-calcula-el-precio-con-una-lista-fases-3-y-4).
- El importe y la referencia quedan **fijados en la línea**: anular, editar o vencer la promoción después no altera un comprobante emitido. Las notas de crédito devuelven al precio cobrado y heredan las dos columnas (`private.copiar_costo_linea_nota`).
- Con la bandera apagada el resultado es idéntico al anterior (baseline pgTAP columna por columna). Migraciones `20270310100000` a `20270310100300` (reversión en cada encabezado); pgTAP `ventas_precio_promocional.test.sql`. La guarda de `confirmar_comprobante` y las pantallas son las fases F-3 y F-2 de la spec `specs/20261113-120000-precio-promocional-en-pos-y-comprobantes/`.

### Guarda de precios al confirmar (MSF-816 · F-3)

`confirmar_comprobante` rechaza, **antes** de tocar costos, stock o estado, una factura cuyo precio promocional ya no es el que se cobraría ahora: error `40001` con `hint = 'precios_cambiaron'` y mensaje «Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total». La transacción no deja rastro (estado, stock, movimientos, costos, cobros y eventos intactos). La app debe re-guardar las líneas (`guardar_lineas_comprobante` reprecia) y pedir cobrar de nuevo; el servidor no reintenta solo.

- **Qué compara y qué NO** (`private.lineas_con_promocion_desactualizada(comprobante, ahora)`, `security definer`, sin `execute` para ningún rol): por línea no manual y no `sin_stock`, mira la **promoción vigente ahora** de la tienda del comprobante contra la guardada. Es candidata **toda línea con promoción, guardada o vigente** (vencida, nueva, sustituida por otra aun con el mismo precio, con otro precio, o la misma que sigue vigente); las candidatas se recalculan con el precio completo (misma función de precio, tipo de cliente, descuento y cantidad del guardado, `private.precio_linea_venta_calculo`) y se rechazan si el resultado difiere. Una línea **sin** promoción guardada ni vigente no se recalcula por la promoción (un cambio solo del precio normal no se rechaza: no hay promoción que cobrar de más). Las líneas sin precio calculable hoy (p. ej. producto en dólares sin cotización) se omiten.
- **La promoción debe seguir siendo estrictamente menor al precio normal (cierra S7, sobrecobro).** Si la promoción guardada sigue vigente al mismo precio pero el precio **normal** bajó hasta quedar igual o por debajo (baja de lista, de escala, de cotización, de la lista de precios del cliente o subida de su descuento), la promoción ya no gana (el motor «gana el más bajo» la ignora) y cobrarla sería cobrar **más** que el precio normal. La guarda rechaza esa confirmación con el mismo contrato que las demás causas (`40001`, hint `precios_cambiaron`) y `detail = 'promocion_no_menor_al_normal'`; la pantalla muestra «Los precios cambiaron: revisá el total y confirmá de nuevo» y al re-guardar la línea se reprecia al precio normal. Si la promoción **sigue ganando** (el normal bajó pero quedó por encima de ella, o subió) no se rechaza: el cliente paga lo que vio y es menor al normal. Antes (decisión S7) este caso se cobraba a la promoción para no recalcular; hoy se recalcula y se mide el costo (abajo).
- **Bandera apagada:** la guarda no actúa, tampoco sobre borradores guardados con promoción (conservan su precio hasta el próximo guardado); al reencender, cada borrador abierto con promoción cambiada se rechaza una vez y se reprecia. Una factura ya `confirmada` vuelve antes de la guarda (idempotencia intacta).
- **Rendimiento (FR-024):** la guarda hace una búsqueda indexada de promoción por línea y recalcula el precio completo solo en las líneas con promoción. Desde el cierre de S7 esas líneas se recalculan con `private.precio_linea_venta_calculo` (`security definer`, sin la compuerta de la sesión por línea): `confirmar_comprobante` ya validó `nivel_ventas_en_empresa = 'edicion'` antes de llamar a la guarda, y la compuerta era ≈ 90 % del costo de `precio_para` (ver «Medición de `precio_para`»: ≈ 6–8,5 ms por llamada con compuerta; la guarda completa sin ella mide ≈ 1,3–2,5 ms por línea (incluye la lista del cliente y la promoción)). Medición en dev (`begin…rollback`, base compartida con carga, mediana de 7 corridas alternadas de `ventas_precio_promocional_ciclo.test.sql`, 200 líneas **todas** con promoción, el peor caso): confirmar con la bandera apagada ≈ 265 ms y encendida ≈ 570–790 ms, es decir ≈ 300–500 ms de sobrecosto (≈ 1,5–2,5 ms por línea; antes del cierre de S7 la guarda sumaba ≈ 0–50 ms porque no recalculaba). Con la compuerta por línea (`precio_linea_venta`) habría sido ≈ 1,3–1,7 s. Una venta real lleva pocas líneas con promoción (≈ 1,5–2 ms cada una) y las líneas sin promoción no se recalculan. El pgTAP de rendimiento acepta razón < 3,5 o sobrecosto < 1000 ms y falla si alguien vuelve a la compuerta por línea. Cuando el cliente no tiene lista de precios hoy, el cálculo se hace sin buscar la lista por línea.
- Migración `20270310100400_confirmar_comprobante_precios_vigentes.sql` (reversión en el encabezado) y `20270431000000_guarda_promocion_sobre_precio_normal.sql` (cierre de S7); pgTAP `ventas_precio_promocional_ciclo.test.sql`. Presupuestos: `aceptar_presupuesto` no reprecia y un presupuesto pendiente conserva su precio hasta que se edita.

### Comportamiento conocido y seguimientos (MSF-816 · F-4)

Lo que sigue está **decidido y probado**; no son defectos ocultos. Cada punto tiene su seguimiento trazado en el tracker (Tareas `seguimiento` con la etiqueta `desarrollo-manual`).

- **Un cambio del precio normal que deja a la promoción guardada igual o por encima del normal SÍ se rechaza al confirmar (FR-009, S7 cerrado).** Antes la guarda solo recalculaba las líneas cuya promoción había cambiado y una baja de lista, escala, cotización o descuento del cliente por debajo de la promoción se cobraba a la promoción (lista 1000 → 700 bajo la promoción 800: 3 unidades a 2904 y no a 2541): un sobrecobro al cliente. Hoy la guarda recalcula toda línea con promoción y, si la promoción guardada sigue vigente pero ya no es estrictamente menor al precio normal, rechaza con `40001`, hint `precios_cambiaron` y `detail = 'promocion_no_menor_al_normal'`; al re-guardar, la línea se reprecia (a 700: 2100 sin IVA, 2541 con IVA). Si la promoción sigue ganando no se rechaza. Los tests «S7» de `ventas_precio_promocional_ciclo.test.sql` y el caso con lista de `ventas_lista_precios.test.sql` lo fijan (incluido el borde normal = promoción y el caso del descuento del cliente). La guarda no se aplica con la bandera `promociones_precio` apagada.
- **Promoción bajo el costo (S3 = MSF-934):** la promoción no se valida contra el costo (ni `guardar_promocion_precio` ni esta épica). Se carga, se cobra y la rentabilidad realizada muestra el margen negativo (estado `negativo`). El margen «actual» por producto/canal (`analitica.margen_producto_canal`) sigue con el precio normal (Decisión 8). Los reportes y la API (`/v1/ventas`, `/v1/precios`), `venta.registrada`, la exportación total y las vistas de consulta de IA no cambiaron de forma: lo prueba `ventas_precio_promocional_reportes.test.sql`.
- **Paridad tienda ↔ local (FR-020):** sin interruptor de IVA el neto del local es igual al precio de la tienda; con «Precios con IVA» la diferencia por unidad es menor a $1 (la tienda redondea el precio final **al centavo** por unidad —antes, al peso: `20270507180200_aplicar_iva_al_centavo.sql`—, el local redondea el subtotal de la línea). Lo prueba `ventas_precio_promocional_paridad.test.sql`.

| Seguimiento | Tema | ID |
|---|---|---|
| S1 | La tienda con sesión de cliente (`precios_cliente_por_dominio`, escalas) aplica las promociones (gana el más bajo, sin acumular). **Hecho** (migración `20270507000200`; ver `promociones-precio.md`): un mayorista ve en la tienda lo que paga en el local | MSF-932 |
| S2 | `copiar_presupuesto` no aplica el descuento del cliente. **Hecho** (migración `20270507000100`): la copia cobra con el descuento vigente del cliente, sin acumularlo con la promoción (gana el más bajo), también con la bandera apagada | MSF-933 |
| S3 | Indicador «ventas con promoción» en reportes y Superset; promoción bajo el costo | MSF-934 (hecho: vista `analitica.ventas_con_promocion` y margen de la promoción; el aviso al cargar quedó en MSF-958, hecho: migración `20270507120000`; pendiente solo el tablero de Superset y una alerta automática con umbral) |
| S4 | PDF del comprobante con el precio de lista tachado (solo si se cambia la Decisión 6) | MSF-935 |
| S5 | `private.precio_vigente_empresa` ignora la promoción mayor o igual al normal (tienda y local coinciden) y `guardar_promocion_precio` avisa al cargarla. **Hecho** (migración `20270433000000`; ver `promociones-precio.md`) | MSF-936 |
| S6 | Bandera apagada y reencendida con borradores abiertos: procedimiento operativo y aviso a los cajeros | MSF-937 (hecho: procedimiento documentado y aviso en el mostrador, ver «Aviso en el mostrador al cambiar la bandera»; no requiere cambio de base) |
| S7 | Recalcular el precio completo en la guarda de confirmar | MSF-938 (cerrado: la guarda recalcula toda línea con promoción y rechaza si deja de ser menor al normal; migración `20270431000000`) |

- **El PDF no cambia (S4):** el comprobante en PDF muestra el precio cobrado, sin el precio de lista tachado.
- **Tienda con sesión de cliente (S1 = MSF-932, hecho):** `publico.precios_cliente_por_dominio` aplica la promoción por escala (gana el más bajo, sin acumular; bandera apagada idéntica); un mayorista ve en la tienda lo que paga en el local (paridad probada con `private.precio_linea_venta`). Detalle en `promociones-precio.md`.
- **Bandera con borradores abiertos (S6):** con la bandera apagada la guarda no actúa y los borradores con promoción conservan su precio hasta el próximo guardado; al reencender, cada borrador abierto con promoción cambiada se rechaza una vez (`precios_cambiaron`) y se reprecia. Avisar a los cajeros al apagar o encender.
- **Indicador «ventas con promoción» (S3, migración `20270326100000`):** la vista `analitica.ventas_con_promocion` (solo `superset_analitica`, grano empresa × producto × fecha, la nota de crédito resta) expone `unidades_con_promocion`, `vendido_con_promocion`, `descuento_promocional` (Σ cantidad × (`precio_referencia` − `precio_unitario`)), `unidades_bajo_costo` (promoción con precio menor al costo guardado en la línea; las líneas sin costo no cuentan) y `pct_unidades_con_promocion`. Es el aviso de «promoción bajo el costo»: se mira, no bloquea (la promoción sigue sin validarse contra el costo). **Pendiente de decisión de producto:** un umbral o alerta automática y el tablero de Superset que consuma la vista. Prueba: `ventas_precio_promocional_reportes.test.sql`. Reversión: `drop view analitica.ventas_con_promocion;`.
- **Promoción bajo el costo (MSF-958, decisión de producto del lote 17): se AVISA, no se bloquea.** `guardar_promocion_precio` sigue guardando y, si el precio promocional neto es **menor** al costo del producto en pesos (`private.a_pesos`, cotización de la empresa; igual al costo que se guarda en la línea), suma `aviso_costo_codigo = 'promocion_bajo_el_costo'` y `aviso_costo`. Solo se suma para quien tiene la sección `rentabilidad` en lectura o edición (la misma condición que la RLS de `dominio.producto_costos`): quien edita promociones sin ver el costo recibe la respuesta de siempre, así no puede acotar el costo por tanteos. Sin costo cargado o con USD sin cotización no hay aviso. Convive con el aviso «no menor al normal». La pantalla Promociones muestra ambos avisos tras guardar. Sin umbral por organización (no se inventó): si negocio lo pide, se compara contra `dominio.rentabilidad_config.umbral_margen_bajo`. Migración `20270507120000_promocion_aviso_bajo_el_costo.sql`; pgTAP `promocion_aviso_bajo_el_costo.test.sql`.
- **Aviso en el mostrador al cambiar la bandera (MSF-937, hecho, solo interfaz):** la pantalla «Venta de mostrador» guarda el valor de `promociones_precio` leído al abrir la venta (primer escaneo, con una lectura nueva: el mostrador queda abierto todo el día) y lo vuelve a leer (`capacidades_precios`) al volver a la pestaña y cada minuto mientras haya una venta abierta (`useBanderaPromociones`). Si cambió, muestra una advertencia cerrable, en una región viva: «Las promociones de precio se activaron/desactivaron mientras esta venta estaba abierta. Revisá los precios y volvé a guardar las líneas…». Una lectura que falla conserva el último valor (no inventa un cambio). El valor base vive en memoria como la venta: al cobrar, descartar o cambiar de tienda se reinicia. No cambia la base: sigue rechazando una vez con `precios_cambiaron` al reencender. Pruebas: `avisoBanderaPromociones.test.ts`, `useBanderaPromociones.test.tsx`, `AvisoBanderaPromociones.test.tsx` (con axe) y `mostrador.test.tsx`.
- **Procedimiento al apagar y reencender `promociones_precio` (S6):** 1) avisar a los cajeros antes de cambiar la bandera; 2) lo ideal es hacerlo fuera de horario o con los borradores de venta cerrados (confirmados o descartados); 3) al **apagar**, los borradores con promoción conservan su precio promocional hasta que se guarden de nuevo (la guarda no actúa) y se cobrarían así si se confirman; 4) al **encender**, cada borrador abierto cuya promoción cambió se rechaza una vez al confirmar con `precios_cambiaron` y hay que volver a guardarlo: es lo esperado, el cajero debe reabrirlo y reconfirmar; 5) verificar después con una venta de prueba. El aviso en la pantalla del mostrador cuando la bandera cambió ya existe (ver arriba); el paso 1 sigue siendo avisar a los cajeros antes de cambiarla.
- **Medición de `precio_para` (MSF-938, dev, sin cambios de código):** medido en dev (2289 productos, una organización, sesión de panel simulada con `request.jwt.claims` dentro de `begin…rollback`; 300 llamadas en bucle `plpgsql`, escala `x1`). La hipótesis anterior (la cadena de cálculo) era **incorrecta**:

  | Pieza | ms por llamada |
  |---|---|
  | `private.precio_para` completa (envoltorio + cálculo) | **6,1 – 6,8** |
  | `private.precio_para_calculo` (sin compuerta de sesión) | **0,65** |
  | `private.precio_sesion_alcanza` (compuerta + aislamiento) | **5,3** |
  | `private.nivel_seccion('empresas')` (una sola evaluación) | 4,0 |
  | `private.roles_de_referencia('empresas')` (dentro de `nivel_seccion`) | 2,3 (de los cuales `empresa_activa_valida` 0,8) |
  | `private.nivel_de_rol` / `matriz_inicial` | 0,19 / 0,45 |
  | `private.organizacion_id()` / `cotizacion_para` / `is_superadmin` | 0,31 / 0,27 / 0,13 |

  **≈ 90 % del costo es la compuerta de permisos** (`nivel_seccion`, que resuelve roles y empresa activa del usuario en cada llamada), no la fórmula de precio, que cuesta ≈ 0,65 ms (`a_pesos`, `aplicar_regla_precio`, `precio_propio_empresa` y la alícuota juntos). El `EXPLAIN (ANALYZE, BUFFERS)` de una llamada muestra ≈ 87 bloques en memoria, todos de la evaluación de la sección. `empresas` suele alcanzar y el `or` evita evaluar `ventas`; un usuario solo con `ventas` paga las dos evaluaciones (≈ 8–9 ms, que es el «≈ 8,5 ms» histórico).

  **No se cambió ninguna función.** Reescribir `nivel_seccion` (la base de la RLS de todo el panel) o cachear su resultado entre llamadas no puede garantizar resultados idénticos (un cambio de rol o de empresa activa dentro de la misma transacción) y excede esta historia. **Recomendación para cerrar S7:** que la guarda de `confirmar_comprobante` (ya `security definer` y ya dentro de la sesión validada por la propia confirmación) llame a `private.precio_para_calculo` / `private.precio_linea_venta_calculo` **sin** repetir la compuerta por línea: a ≈ 0,65 ms por línea, recalcular 200 líneas cuesta ≈ 130 ms en vez de ≈ 1,3 s, y permite recalcular el precio completo en todas las líneas y pasar el test «S7 (decisión)» de `ventas_precio_promocional_ciclo.test.sql` a rechazo `40001`. Esto cambia el comportamiento de la guarda (es el objetivo de S7), por lo que va en una historia aparte con su pgTAP de comparación, y con la compuerta evaluada una sola vez por comprobante. Esa recomendación se aplicó en `20270431000000_guarda_promocion_sobre_precio_normal.sql`: la guarda recalcula las líneas con promoción con `precio_linea_venta_calculo` (sin la compuerta por línea) y el test «S7» pasó a rechazo `40001`.

## Costo y cotización por línea (F-REN-09)

`confirmar_comprobante` guarda en cada línea `costo_unitario` (costo en pesos por unidad) y `cotizacion` (dólar vigente) al confirmar, una sola vez: reconfirmar o cambiar el costo después no los mueve. Las notas de crédito copian el costo de la línea original. Detalle y vista `analitica.rentabilidad_ventas_real` en `docs/rentabilidad.md`. Con el alcance de la cotización en «Una por empresa» (F-PRE-06) la cotización y el costo salen de la cotización de la empresa del comprobante (o de la general si la empresa no tiene una propia), igual que el precio de la línea.

## Carga infinita e imagen en las líneas

La lista de Presupuestos pasa a carga infinita (ver `ventas-listado-comprobantes.md`). En el detalle del comprobante, la tabla de **Líneas** muestra la imagen principal del producto (`producto_id`) como miniatura 40×40 con zoom al pasar el mouse (`MiniaturaProducto` + `useImagenesProductos`) junto al nombre; las líneas `sin_stock` (de Service) no tienen producto y no llevan miniatura.

## Presupuestos creados desde la tienda (MSF-176, B2)

Un cliente con cuenta web activa puede pedir un presupuesto desde su lista de pedido (`publico.crear_presupuesto_tienda`, solo `authenticated`; ver [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md)). Es un comprobante común de Ventas: `tipo = presupuesto`, `estado = pendiente`, **`canal = tienda_online`**, **`operador_id` nulo**, `valido_hasta` nulo (el operador lo fija), de la tienda del host y a nombre del cliente de la cuenta, con numeración correlativa de la tienda y las mismas columnas de línea que arma `guardar_lineas_comprobante` (el precio lo calcula `private.precio_linea_venta_calculo`: escala, descuento de la ficha, precio propio, promoción vigente e IVA). **No reserva ni descuenta stock y no crea cobros.** En Presupuestos la columna Operador dice «Tienda online (cliente)» y la ficha lleva el rótulo «Creado desde la tienda por el cliente» (y la «Nota del cliente», si la escribió). El operador lo acepta, modifica o copia con los flujos de siempre (un presupuesto no se anula: solo se anulan facturas confirmadas); la tienda no puede modificarlo después de crearlo. El origen «Tienda online (cliente)» (columna Operador del listado, del CSV de comprobantes y presupuestos y de la ficha) se deriva del **vínculo real** `dominio.presupuestos_tienda`, no del canal: `obtener_comprobante` devuelve además `de_tienda`. Tope por cuenta: 5 creados por día y 10 `pendiente` abiertos.

## Textos de ayuda del stock

Confirmar la factura descuenta el stock de cada producto; solo las líneas «A pedido» quedan reservadas y se descuentan al entregarlas. Las ayudas del estado «Pendiente», «Armando», de la tabla de líneas y del despacho dicen eso y no «se descuenta al entregar». Pendientes de decisión: MSF-609 (las RPC de documentos, envío, responsables y faltantes exigen estado `confirmada`; mostrar las tarjetas en otros estados requiere cambiar la base) y MSF-615 (anular y editar una reparación entregada es decisión de negocio).
