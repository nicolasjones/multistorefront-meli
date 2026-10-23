# Ventas · Comprobantes

Alta y edición de la **cabecera** de una factura o un presupuesto (F-VTA-05, MSF-273, épica MSF-159). Las
líneas, la confirmación de stock y la pantalla de Presupuestos son de las historias siguientes
(F-VTA-06/07/08) y no se documentan acá.

## Pantalla

- **Alta**: `/ventas/comprobantes/nuevo` (con `?tipo=presupuesto` abre un presupuesto).
- **Edición / consulta**: `/ventas/comprobantes/:id`.
- `/ventas` y `/ventas/comprobantes` redirigen al alta hasta que MSF-177 entregue el listado.
- Menú **Ventas** (`ReceiptLongIcon`), audiencia por la sección `ventas`; sin la sección, la ruta muestra
  «Acceso restringido».
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

## Modelo de datos

Esquema (Principio VII):

| Tabla | Esquema | Naturaleza |
|---|---|---|
| `dominio.comprobantes_venta` (existente, se altera de forma aditiva) | `dominio` | Documento de venta: entidad de negocio del producto. |
| `dominio.comprobantes_venta_numeracion` (nueva) | `dominio` | Contador correlativo del documento de venta. |

Columnas agregadas a `dominio.comprobantes_venta` (`20261024100100_comprobantes_cabecera.sql`):

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

RLS vigente: `select` por organización y sección `ventas` (`lectura`/`edicion`). **Sin** políticas ni
grants de escritura directa: se escribe solo por las RPC `security definer`. `anon` sin acceso.

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
| `obtener_comprobante(p_id)` | Cabecera + cliente + operador + totales; exige `lectura` o `edicion`. Las líneas llegan con F-VTA-06 (hoy `[]`). |

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` no existe · `55000` documento
cerrado · `40001` conflicto de edición. `apps/web/src/lib/ventas.ts` los traduce a mensajes en castellano.

## Actividad

Cada alta y cada edición registran `comprobante.creado` / `comprobante.editado` con
`private.registrar_actividad`, en la misma transacción que la escritura, asociados a la tienda del
comprobante (FR-008).

## Permisos

- Sin la sección `ventas`: «Acceso restringido» (no se llega a la pantalla).
- `lectura`: se ve el comprobante; no hay «Guardar cambios» ni alta.
- `edicion` en la empresa del comprobante: alta y edición mientras el documento sea editable.
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

## Fuera de alcance (esta historia)

Líneas y «Agregar producto» (F-VTA-06), «Confirmar factura» (F-VTA-07), pantalla Presupuestos (F-VTA-08),
listado y anulación (MSF-177), impresión y envío (MSF-213), cobro/conciliación, despacho, notas de crédito,
observaciones e historial de estados. La elección de forma de pago y envío en pantalla espera los catálogos
de MSF-139; la base ya los acepta y los valida cuando existan.

## Reversión

Las migraciones son **aditivas** y documentan su reversión en el encabezado:

1. `20261024100100_comprobantes_cabecera.sql`: quitar índices y columnas agregadas.
2. `20261024100200_comprobantes_numeracion.sql`: `drop function private.siguiente_numero_comprobante` y
   `drop table dominio.comprobantes_venta_numeracion`.
3. `20261024100400_comprobantes_rpc.sql`: `drop function` de `crear_comprobante`, `guardar_comprobante`,
   `obtener_comprobante` y de las funciones privadas de apoyo.

Si Ventas ya escribió, exportar antes `dominio.comprobantes_venta` y su numeración: las columnas nuevas no
se borran en el mismo PR que las crea.
