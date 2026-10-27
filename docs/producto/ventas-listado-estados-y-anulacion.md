---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · listado, estados y anulación (MSF-177)

**Épica:** MSF-177 · **Historias:** F-VTA-09 (listado con filtros y exportación), F-VTA-10 (estados del
comprobante y de cobro) y F-VTA-11 (anulación y nota de crédito). **Spec:**
`specs/20261024-130000-ventas-listado-estados-y-anulacion/` · **Rama:**
`epic/MSF-177-ventas-y-despacho-ventas-listado-estados`, pendiente de merge a `main`.
Detalle técnico: [Ventas · listado, estados y anulación (técnico)](../tecnico/ventas-listado-estados-y-anulacion.md).

Esta página explica **qué resuelve** la épica: buscar y exportar todo lo vendido, saber en qué estado está
cada comprobante y corregir una venta sin borrar datos. La factura y el presupuesto se cargan en
[Ventas · comprobantes (MSF-159)](ventas-comprobantes.md).

## Qué resuelve

- **Un listado de todo lo vendido** con búsqueda por cliente o número, filtros por Operador, Estado, Pago,
  Envío y Tienda, paginación en el servidor y **exportación a CSV** (de una vez o por encima de 10.000
  filas).
- **Un estado claro por comprobante**: en qué punto está el cobro y el armado, con el **historial** de quién
  cambió qué y cuándo.
- **Correcciones sin perder trazabilidad**: una factura emitida por error se **anula** (deja de valer, vuelve
  el stock) y una devolución o un ajuste se corrige con una **nota de crédito** (un documento propio que
  resta de lo facturado). Nada se borra: el número no se reutiliza y queda quién, cuándo y por qué.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Mostrador** | Busca y filtra comprobantes, y mueve la factura de **Pendiente** a **Aceptado** o **En proceso**. |
| **Depósito** | Ve el historial y mueve la factura de **Aceptado** a **Armando** y de **Armando** a **Incompleto** (y de vuelta). |
| **Administración** | Lo mismo que Mostrador y Depósito, y además **anula** facturas y **emite notas de crédito**. |
| **Administrador** | Igual que Administración. |
| **Operador** | Exporta el listado a CSV (acción `exportar`). En la matriz inicial tiene edición en Ventas, así que también carga comprobantes (MSF-159). |
| **Consulta** | Solo ve el listado y el detalle; la tarjeta de estados le aparece con todo deshabilitado. |

Sin la sección **Ventas** la pantalla muestra «Acceso restringido».

## El listado de comprobantes

La pantalla **Ventas › Comprobantes** (`/ventas/comprobantes`) reemplaza la redirección al alta que existía
hasta MSF-159. Muestra las **facturas y las notas de crédito** de las tiendas a las que la persona tiene
acceso; los **presupuestos** tienen su propia pestaña.

- **Columnas:** Comprobante (número y tipo, con enlace al detalle) · Tienda · Fecha · Cliente · Operador ·
  Estado (con su color) · Pago · Envío · Total (a la derecha). Las notas de crédito aparecen con el total en
  negativo.
- **Contador** «N comprobantes» y paginación de 12 por página («1–12 de N»).
- **Búsqueda** «Buscar por cliente o número»: no distingue mayúsculas ni tildes y tolera espacios sobrantes.
- **Filtros** Operador · Estado · Pago · Envío, cada uno con «Todos», y **«Limpiar filtros»** (aparece solo
  con filtros o búsqueda). El filtro **Tienda** usa las píldoras «Todas las tiendas» + las tiendas
  accesibles.
- **Estados de la pantalla:** carga inicial, error con «Reintentar», «Sin resultados» («Probá con otra
  búsqueda o limpiá los filtros.») y vacío real («Todavía no hay comprobantes.»). En pantallas angostas la
  tabla se muestra como tarjetas.
- Sin la acción `exportar` el botón **Exportar** no se ofrece; sin **edición** en Ventas tampoco se ofrece
  **Nuevo comprobante**.

## Exportar a CSV

El botón **Exportar** elige la vía según cuántas filas coinciden con los filtros:

| Vía | Cuándo | Qué pasa |
|---|---|---|
| **Inmediata** | Hasta 10.000 filas | Se baja el CSV en el momento, con **todas** las filas del filtro (no solo la página). |
| **Diferida** | Más de 10.000 filas | La pantalla avisa «Exportación solicitada: se está generando. Cuando termine, descargala desde acá.» y ofrece **Descargar** en el mismo aviso. |

El CSV lleva las columnas Comprobante, Tipo, Tienda, Fecha, Cliente, Operador, Estado, Pago, Envío y Total,
con separador `;` y codificación que Excel abre bien. Con filtros que devuelven **0 filas** no se descarga
nada: se avisa «Sin resultados».

## Los estados del comprobante

La tarjeta **Estado** del detalle muestra un chip por estado del panel, con el estado actual marcado y el
texto de ayuda correspondiente. Los chips que el rol no puede usar aparecen **deshabilitados con el motivo**
(por ejemplo «Tu rol no puede pasar de Aceptado a Cobrado»).

| Estado guardado | Cómo se muestra | Quién lo cambia |
|---|---|---|
| `borrador` | **Borrador** | — (todavía no se confirmó) |
| `confirmada` | **Pendiente** | — (MSF-159) |
| `aceptado` | **Aceptado** | Mostrador, Administración, Administrador |
| `en_proceso` | **En proceso** | Mostrador, Administración, Administrador |
| `armando` | **Armando** | Depósito, Administración, Administrador |
| `incompleto` | **Incompleto** | Depósito, Administración, Administrador |
| `cobrado` / `deuda` | **Cobrado** / **Deuda** | **Nadie a mano**: los actualiza el cobro (MSF-195) |
| `anulada` | **Anulada** | — (el documento dejó de valer) |

- El chip de estado va **junto al título** del comprobante.
- El catálogo de etiquetas y colores es **uno solo** para toda la app (`apps/web/src/lib/estadosComprobante.ts`):
  «Pendiente» es la forma de mostrar `confirmada`, y «Entregado» **no** existe todavía (es de MSF-135).
- Cambiar de estado **queda registrado**: «Estado: Pendiente → Aceptado en la factura N», con usuario, fecha y
  tienda.
- La tarjeta **Historial de estados y acciones** lista **Cuándo, Acción, Quién y Tienda** de todo lo que le
  pasó al comprobante, con la nota «El comprobante pertenece a una sola tienda…».
- Un **borrador**, una factura **anulada** o un comprobante de **otra tienda** no admiten cambios de estado.
  Reintentar el mismo estado no duplica nada.

## Anular una factura

**Anular** corrige una factura **emitida por error**: el documento deja de valer.

- Solo la **Administración** y el **Administrador** (acción `anular` de Ventas).
- El diálogo pide un **motivo obligatorio** (hasta 300 caracteres) y avisa que no se puede deshacer:
  «Anular corrige una factura emitida por error: deja de valer, el stock vuelve a cada depósito de origen y
  se liberan las reservas «A pedido». El número no se reutiliza y queda registrado quién la anuló y por qué.»
- Al anular: la factura pasa a **Anulada**, el **stock vuelve a cada depósito de origen**, las reservas «A
  pedido» se liberan y queda el evento con el motivo, quién y cuándo. **Todo o nada**: si algo falla, nada
  cambia.
- **No se puede anular** una factura que ya tiene una **nota de crédito** ni una que ya está **Cobrada**: en
  esos casos se corrige con una nota de crédito. Tampoco se anula un borrador (no movió nada) ni un
  presupuesto.
- La factura anulada queda **de solo lectura**, con su chip y el motivo visible.

## Emitir una nota de crédito

**Nota de crédito** corrige una **devolución o un ajuste** sobre una factura válida. Es un **documento de
venta propio**: tiene número correlativo propio y queda asociado a la factura.

El diálogo «Nota de crédito» ofrece tres motivos, con su descripción y un ejemplo:

| Motivo | Qué hace | Efecto en stock |
|---|---|---|
| **Devolución de productos** | Se indican los productos y las cantidades a devolver | La mercadería **vuelve al depósito de origen** de cada línea |
| **Devolución de importe** | Se devuelve dinero, sin mercadería | No toca el stock |
| **Descuento o bonificación** | Ajuste de precio, sin mercadería | No toca el stock |

- Solo **Administración** y **Administrador** (acción `emitir_nota_credito`).
- No se puede acreditar **más de lo facturado**: por línea en «Devolución de productos» y por importe en los
  otros dos motivos. Se admiten notas **parciales**; la base dice cuántos quedan por acreditar.
- La factura muestra una tarjeta por nota: **«Nota de crédito {número}»**, la etiqueta «Asociada a esta
  factura», el tipo y su descripción, la tabla Producto · Cantidad · Precio · Importe y el aviso de que las
  **cantidades y los importes van en negativo** porque restan de lo facturado.
- El **ranking de clientes** y los totales del listado pasan a contar la nota con **signo negativo**: lo
  facturado es el neto.

!!! note "Anular ≠ nota de crédito"
    **Anular** es para un **error**: el documento deja de valer y se revierte lo que movió. **Nota de crédito**
    es para una **devolución o un ajuste** sobre un documento válido. Ninguna de las dos borra datos.

## Empresa activa

El filtro **Tienda** del listado sigue a la **empresa activa** de la barra superior: por defecto se ven todas
las tiendas accesibles y, al elegir una en la barra, el listado se acota a esa.

- Al **cambiar de empresa** se invalidan y recargan **todas** las consultas de la pantalla, la paginación
  vuelve a la página 1 y se descarta la selección que ya no existe.
- En el **detalle** del comprobante, si la empresa activa pasa a ser otra tienda distinta de la del
  comprobante, la pantalla **se cierra con aviso**: nunca se muestran ni se guardan datos de una tienda bajo
  otra.
- Los **diálogos abiertos** (Anular, Nota de crédito) se desmontan al cambiar de empresa: no guardan nada de
  la empresa anterior.

## Matriz pantalla↔criterios

| Ítem visible | Dueño |
|---|---|
| Tabla Comprobante, Tienda, Fecha, Cliente, Operador, Estado, Pago, Envío, Total | FR-001, FR-005 |
| Columna final sin título (botón «Imprimir» por fila) | **FUERA DE ALCANCE** — impresión: MSF-213 |
| «Buscar por cliente o número» | FR-002, FR-005 |
| Filtros Operador / Estado / Pago / Envío y «Limpiar filtros» | FR-003, FR-005 |
| Estado: Pendiente, Aceptado, Cobrado, En proceso, Deuda, Armando, Incompleto | FR-003, FR-023 |
| Estado: opción «Entregado» | **FUERA DE ALCANCE** — MSF-135 |
| Botón «Exportar» | FR-006, FR-010 |
| Botón «Nuevo comprobante» | FR-005 (ruta de alta de MSF-159) |
| Pestañas Comprobantes / Presupuestos | FR-005 (Presupuestos ya existe, MSF-159) |
| Pestañas Pagos / Faltantes / Devoluciones (RMA) / Transportes | **FUERA DE ALCANCE** — MSF-195, MSF-135, MSF-178, MSF-139 |
| Filtro Tienda (píldoras) y su texto «Por defecto se ven todas…» | FR-004 |
| Contador «N comprobantes», paginación «1–12 de N», «Sin resultados» | FR-005 |
| Tarjetas KPI (Facturado hoy, Pendiente de cobro, En armado, Con deuda) | **FUERA DE ALCANCE** — dependen de cobros (MSF-195) y reportes (MSF-338) |
| Letra A/B del tipo («Factura B») | **FUERA DE ALCANCE** — el comprobante es interno, no fiscal |
| Tarjeta «Estado» (chips, ayuda) y chip junto al título | FR-023, FR-024 |
| Tarjeta «Historial de estados y acciones» (Cuándo, Acción, Quién, Tienda) | FR-025, FR-027 |
| Botón «Nota de crédito» y su diálogo (motivos, ejemplo, Cancelar / Emitir) | FR-043, FR-045 |
| Tarjeta de la nota («Asociada a esta factura») y su tabla | FR-046 |
| Acción «Anular» (no está en el prototipo) | FR-040, FR-042 |
| Cuenta de cobro, «Ir a Pagos →», «Sin conciliar» | **FUERA DE ALCANCE** — MSF-195 |
| Guía, Armó / Controló / Entregó, transporte, «Copiar», «Imprimir», flete, observaciones | **FUERA DE ALCANCE** — MSF-135, MSF-213, no pedido por la épica |
| **Empresa activa** | FR-004, FR-024, FR-045 |

## Permisos

| Acción | Sección | Quién |
|---|---|---|
| Ver el listado y el detalle | `ventas` ≥ lectura | Quien tenga Ventas en lectura o edición en la tienda |
| Cambiar el estado | matriz de transiciones del rol | Mostrador, Depósito, Administración, Administrador |
| Exportar a CSV | acción `exportar` de Ventas | Administrador, Operador, Administración |
| Anular una factura | acción `anular` de Ventas + `ventas` en edición | Administrador, Administración |
| Emitir una nota de crédito | acción `emitir_nota_credito` de Ventas + `ventas` en edición | Administrador, Administración |

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Límites y decisiones abiertas

- **La matriz de estados y roles es una propuesta a confirmar con el cliente.** Está sembrada **por datos**
  (una fila por organización, tipo, estado desde/hasta y rol), así que corregirla es una migración de datos,
  no un cambio de estructura.
- **Editar la matriz desde una pantalla es Etapa 2** (Roadmap a diciembre): hoy se cambia por datos, con una
  migración.
- **Cobrado y Deuda** existen, se muestran y se filtran, pero **nadie los cambia a mano**: los dispara el
  cobro (MSF-195), que ya está entregado en su rama de épica.
- **«Entregado»** (visible en el prototipo) es de MSF-135: no se entrega aquí y por eso no está en el filtro
  de Estado.
- **El listado es solo de ventas internas**: **Mercado Libre** se suma en Etapa 2.
- **Los presupuestos no se anulan** ni reciben nota de crédito.
- **Descuento sobre cuenta corriente**: fuera de alcance (MSF-195).
- El **tipo «Factura A/B»** del prototipo no aplica: el comprobante es interno, no fiscal.

## Fuera de alcance de esta épica

Cobro y conciliación (MSF-195), despacho, entrega y reservas «A pedido» ya entregadas (MSF-135), RMA y
devoluciones (MSF-178), transportes y contrarreembolsos (MSF-139), impresión y envío por correo (MSF-213),
reportes de ventas (MSF-338) y rentabilidad real (MSF-192).

## Estado

Implementado en la rama de la épica con sus tres historias y el cierre (F-VTA-09, F-VTA-10, F-VTA-11),
**pendiente de merge a `main`**. La fuente funcional es
`specs/20261024-130000-ventas-listado-estados-y-anulacion/spec.md`; las pruebas están en
`supabase/tests/database/comprobante_*.test.sql` y `ventas_listado_exportacion.test.sql`, en
`apps/web/src/pages/ventas/comprobantes.test.tsx`, `comprobante.estados.test.tsx`,
`comprobante.anulacion.test.tsx` y en `workers/exportar-comprobantes/test/`.

## Para seguir

- **[Ventas · listado, estados y anulación (técnico)](../tecnico/ventas-listado-estados-y-anulacion.md)** —
  tablas, RPC, worker, flow y reversión.
- **[Ventas · comprobantes (producto)](ventas-comprobantes.md)** — cómo se carga la factura y el presupuesto.
- **[Permisos por rol](../permisos-por-rol.md)** — secciones, niveles y acciones.
- **[Stock](../stock.md)** — depósitos, movimientos y reservas.
