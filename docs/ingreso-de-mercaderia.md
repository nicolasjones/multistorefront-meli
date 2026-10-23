---
owner: producto
sources:
  - specs/20261021-183246-ingreso-de-mercaderia-por-proveedor
---

# Ingreso de mercadería por proveedor

Épica MSF-219. Al terminar, el depósito registra la mercadería que llega de cada
proveedor, el stock del depósito único sube de forma atómica y queda un historial
con fecha, producto, cantidad, operador y proveedor.

## Alcance de esta entrega

- **F-PRV-04 (MSF-383)**: registrar un ingreso con empresa, proveedor, fecha,
  comprobante opcional y N líneas (producto, cantidad, costo unitario USD).
- **F-PRV-05 (MSF-393)**: historial paginado; los filtros completos y la
  anulación llegan con su historia.
- **F-PRV-06 (MSF-404)**: anulación con motivo, reversión atómica del stock y
  trazabilidad de la salida.

## Pantalla

- Ruta `/stock/ingresos`, dentro del ítem **Stock**, pestaña «Ingreso de
  mercadería».
- Formulario «Nuevo ingreso» y «Últimos ingresos» debajo, como el prototipo.
- Con Stock en solo lectura se ve el historial y se oculta el formulario.
- El selector de depósito y la separación Local/Depósito del prototipo **no
  aplican** al stock único de MSF-136: «Destino» se muestra como «Depósito
  principal». Los depósitos llegan con MSF-292.

## Modelo de datos

| Tabla | Qué guarda | Escritura |
|---|---|---|
| `dominio.ingresos_mercaderia` | empresa, proveedor, fecha, comprobante, estado (`registrado` / `anulado`), datos de anulación, actor, `clave_idempotencia` | Solo `public.registrar_ingreso_mercaderia` (security definer). |
| `dominio.ingresos_mercaderia_lineas` | producto, cantidad, costo unitario USD, vínculo al movimiento de entrada y al de anulación | Solo la RPC. |
| `dominio.movimientos_stock` | entrada por línea con motivo «Compra a proveedor»; salida al anular | Solo `public.registrar_movimiento_stock` (MSF-136). |
| `dominio.producto_costos` | costo del producto cuando se marca «Actualizar el costo…» | Solo la RPC, con `rentabilidad` en edición. |

Las tablas nuevas tienen RLS de solo lectura para `authenticated` con
`nivel_seccion('stock')` en `lectura` o `edicion`; `anon` no tiene privilegios y
no hay políticas de escritura directa.

## RPC

### `public.registrar_ingreso_mercaderia(...)`

Parámetros: `p_empresa`, `p_proveedor`, `p_fecha`, `p_comprobante`, `p_lineas`
(JSON con `producto_id`, `cantidad`, `costo_unitario_usd`), `p_actualizar_costo`
y `p_clave_idempotencia`.

- Exige `nivel_seccion('stock') = 'edicion'` y una empresa accesible y activa.
- Valida proveedor activo, productos activos de la organización, fecha no futura,
  cantidades enteras > 0, costos ≥ 0 con hasta dos decimales y sin productos
  repetidos (hasta 100 líneas).
- Por cada línea llama a `registrar_movimiento_stock` con tipo `entrada` y motivo
  «Compra a proveedor», y vincula el movimiento.
- Con `p_actualizar_costo = true` exige `rentabilidad` en edición y actualiza
  `dominio.producto_costos.costo`; no toca el precio de lista.
- Todo ocurre en una transacción: si una línea falla, no queda cabecera, línea,
  movimiento, costo ni evento.
- Registra `ingreso.registrado` en la actividad, sin importes.

**Idempotencia**: `(organizacion_id, clave_idempotencia)` es única. El cliente
genera la clave; un reintento con la misma clave devuelve el ingreso existente
sin volver a mover stock.

### `public.anular_ingreso_mercaderia(p_ingreso, p_motivo)`

- Exige `stock` en edición y un motivo de 3 a 500 caracteres.
- Bloquea la cabecera (`for update`), rechaza un ingreso ya anulado y crea una
  `salida` por línea con el motivo «Anulación de ingreso de mercadería».
- Si alguna línea no tiene stock suficiente, **no anula nada** (la RPC de stock
  falla y toda la transacción se revierte).
- Marca la cabecera `anulado` con actor y fecha, vincula los movimientos de
  anulación y registra `ingreso.anulado`.
- Dos anulaciones concurrentes se serializan con el bloqueo de la cabecera.

### `public.listar_ingresos_mercaderia(...)`

`security invoker` (RLS): una fila por producto con fecha, producto/SKU,
cantidad, costo, destino, empresa, proveedor, operador, estado y el total del
conjunto filtrado. Pagina en el servidor (25 por defecto, tope 100) y acepta
filtros por fechas, proveedor, empresa, producto y operador.

Número de fila del archivo de ingresos: `previsualizar_lote_archivo_ingresos` y
`aplicar_lote_archivo_ingresos` exigen un entero positivo (`^[1-9]\d{0,8}$`); la
fila `0`, los ceros a la izquierda, los decimales y los valores fuera de rango
se rechazan con `22023`.

## Permisos

| Acción | Requisito |
|---|---|
| Ver el historial | `stock` en `lectura` o `edicion` |
| Registrar un ingreso | `stock` en `edicion` |
| Actualizar el costo del producto | además, `rentabilidad` en `edicion` |
| Anular (F-PRV-06) | `stock` en `edicion` |

La UI oculta lo que el rol no puede hacer; la base lo vuelve a validar.

## Pruebas

- pgTAP `ingresos_mercaderia_base.test.sql` (esquema, RLS, privilegios, motivo).
- pgTAP `ingresos_mercaderia_registrar.test.sql` (stock atómico, costo por
  permiso, idempotencia, rechazos, aislamiento, `anon`).
- pgTAP `ingresos_mercaderia_historial.test.sql` (orden, total, filtros,
  paginación, detalle, operadores, `anon`).
- pgTAP `ingresos_mercaderia_anular.test.sql` (reversión, motivo, doble
  anulación, stock insuficiente, permisos y aislamiento).
- Vitest de `lib/ingresos`, `useRegistrarIngreso` e `IngresoMercaderiaForm`.

## Archivo anterior al sistema (F-MIG-03, MSF-330)

Segunda pestaña de Stock › Ingreso de mercadería: el historial de ingresos del panel
anterior, como archivo de **solo consulta** (no dibujada en el prototipo; usa la tabla del
historial con Fecha, Producto, Cantidad, Proveedor y Operador, paginada en servidor).

- **Tabla** `dominio.archivo_ingresos_mercaderia` (esquema `dominio`: historial del negocio).
  Producto, proveedor y operador son **texto** (los ~19 operadores históricos no son usuarios).
  Único por `(organizacion_id, id_externo)`: reimportar actualiza, no duplica.
- **Solo lectura:** RLS con `select` por organización (`stock` en `lectura`/`edicion`); sin
  insert/update/delete para `authenticated` ni acceso para `anon`. Escribe únicamente la RPC
  `aplicar_lote_archivo_ingresos` (Administrador), desde el asistente en
  `/migracion/importar/ingresos_archivo` (`previsualizar_lote_archivo_ingresos` solo lee).
- **No toca stock** ni `dominio.ingresos_mercaderia`: sin FK a productos, proveedores ni
  depósitos; el stock inicial entra por la carga inicial de Stock (F-STK-07).
- **Empresa activa (Principio VIII):** el archivo es de la organización (el panel anterior no
  tenía empresas); la pestaña lo dice y no filtra ni recarga al cambiar de empresa.
- **Plantilla CSV** `ingresos-anteriores.csv`: Identificador del panel actual, Fecha
  (`AAAA-MM-DD` o `DD/MM/AAAA`), Producto, Cantidad (entero), Proveedor, Operador.
- **Confirmación abierta (FR-035):** falta confirmar que el panel actual **exporta ingresos a
  CSV/Excel** (para clientes ya está confirmado). Si no exporta, la carga depende de otra vía.
- **Reimportar no borra valores:** si `proveedor` u `operador` vienen vacíos en una reimportación, se conserva el valor anterior (`coalesce`); para vaciarlos hay que corregirlos con un valor explícito.
- **Identificador repetido:** la vista previa marca como error el `id_externo` repetido dentro del mismo lote (gana la primera fila válida), igual que el aplicado; entre lotes distintos solo el aplicado lo detecta.
- **Pruebas:** pgTAP `archivo_ingresos.test.sql` (escritura directa rechazada, `anon`, rol,
  aislamiento, idempotencia, stock e ingresos intactos); Vitest `ArchivoIngresos`,
  entidad `ingresos` y guarda de fixtures sintéticas.
- **Reversión** (migración posterior, exportando antes los datos): `drop function
  public.previsualizar_lote_archivo_ingresos(jsonb), public.aplicar_lote_archivo_ingresos(uuid,
  integer, jsonb), private.clasificar_fila_archivo_ingreso(uuid, jsonb),
  private.validar_fila_archivo_ingreso(jsonb), private.fecha_archivo_ingreso(text);` y
  `drop table dominio.archivo_ingresos_mercaderia;`.

## Reversión

Migraciones posteriores, exportando antes los datos:

```sql
drop function public.anular_ingreso_mercaderia(uuid, text);
drop function public.operadores_ingresos_mercaderia();
drop function public.detalle_ingreso_mercaderia(uuid);
drop function public.listar_ingresos_mercaderia(date, date, uuid, uuid, uuid, uuid, integer, integer);
drop function public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid);
drop table dominio.ingresos_mercaderia_lineas;
drop table dominio.ingresos_mercaderia;
-- restaurar private.sembrar_motivos_movimiento y borrar el motivo de anulación
```
