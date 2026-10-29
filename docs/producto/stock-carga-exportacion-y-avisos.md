---
owner: producto
sources:
  - specs
---

# Stock · carga inicial, exportación y avisos (MSF-368)

**Qué resuelve:** que el equipo **arranque con el inventario real cargado desde una planilla**, pueda **sacar el
stock y los movimientos a CSV** y **reciba un resumen de reposición sin tener que entrar a mirar**. Además, que
sepa **qué se vendió sin stock**, a quién avisar cuando la mercadería vuelve y **qué productos se venden más**.

Reúne las cinco historias de la épica MSF-368:

| Historia | Qué agrega |
|----------|------------|
| F-STK-07 · Carga inicial y masiva de stock (MSF-380) | Cargar el stock contado desde un `.xlsx`, con vista previa y aplicando solo las filas válidas |
| F-STK-08 · Exportar stock y movimientos (MSF-388) | Botón «Exportar» en Stock actual y Movimientos: un CSV con lo que se ve en pantalla |
| F-STK-09 · Avisos de reposición (MSF-394) | Correo diario con los productos que **entraron en alerta** (stock bajo o sin stock) |
| F-STK-17 · Faltantes con aviso de reposición (MSF-405) | Pestaña «Faltantes»: las líneas «A pedido» de facturas confirmadas, y el aviso al cliente cuando el producto vuelve |
| F-STK-18 · Reporte de productos más vendidos (MSF-414) | Pestaña «Más vendidos»: ranking de unidades por período |

**Estado:** implementado en la rama de la épica (`epic/MSF-368-stock-stock-carga-exportacion-y-avisos`); pendiente
de merge a `main` a la fecha de esta página. Spec:
`specs/20261024-130000-stock-carga-exportacion-y-avisos/`.

## Para quién

| Persona | Qué hace |
|---------|----------|
| **Depósito u Operador/a con edición en Stock** | Carga el inventario desde la planilla y exporta el stock y los movimientos |
| **Operación con ventas en edición en la tienda** | Ve los faltantes y avisa a los clientes cuando la mercadería vuelve |
| **Consulta o cualquier rol sin edición en Stock** | Exporta, ve el ranking de más vendidos y los faltantes de las tiendas donde tiene ventas |
| **Administrador/a** | Es el destinatario del resumen de reposición (tiene edición en Stock) y ve los avisos registrados |

## Carga inicial desde una planilla (F-STK-07)

En **Stock → Actualizar por Excel** (`/stock/excel`, solo con **edición** en Stock) el equipo sube el inventario
contado y lo deja asentado sin tipear producto por producto.

**Cómo se hace:**

1. Se elige el **depósito de mercadería** (por defecto, el depósito marcado como por defecto).
2. Se baja la **plantilla** (`stock.xlsx`) o se elige un `.xlsx` propio.
3. La planilla se lee en el navegador y **el servidor valida cada fila**: no se aplica nada hasta ver la vista
   previa.
4. La vista previa muestra, por fila: **SKU · Producto · Stock actual · En planilla · Quedará · Diferencia ·
   Validación**, con los contadores **«N cambios»** y **«N con error»**. Las filas con error se resaltan.
5. **«Aplicar N ajustes»** aplica **solo las filas válidas**: cada diferencia genera un movimiento de tipo
   **Ajuste** en el depósito elegido. Las demás quedan sin tocar y se informa cuántas se omitieron.

**Formato de la planilla** (primera hoja, encabezados en la primera fila):

| Columna | Contenido |
|---------|-----------|
| `sku` | Código del producto (obligatorio). Se recorta; un SKU numérico se lee como texto |
| `cantidad` | Unidades que debe tener el depósito elegido (entero ≥ 0) |
| `motivo` | Opcional (hasta 500 caracteres). Queda como nota del movimiento |

La pantalla incluye la tarjeta **«Formato de la planilla»** con esta tabla y la nota «Las reservas por "A pedido"
no cambian: se ajusta el stock físico, no el disponible».

**Reglas por fila** (las evalúa la base, no la pantalla):

| Situación | Qué pasa |
|-----------|----------|
| SKU vacío | Error de fila |
| SKU repetido en la planilla | Error de fila |
| El SKU no existe en la organización | Error de fila («SKU no existe»); no se revela si el SKU es de otra organización |
| El producto está inactivo | Error de fila («Producto inactivo») |
| La cantidad no es un entero ≥ 0 | Error de fila |
| El `motivo` supera los 500 caracteres | Error de fila |
| El producto **ya tuvo su carga inicial** | Error de fila: **una sola carga inicial por producto** |
| La cantidad del depósito es menor que lo reservado | Error de fila: el stock físico no puede quedar bajo lo reservado |
| La cantidad es igual a la actual | «Sin cambios»: no es error, no genera movimiento y no consume la carga inicial |

**Después de aplicar**, la pantalla confirma «Stock actualizado. Se registraron N movimientos de ajuste. Podés verlos
en Stock · Movimientos», avisa cuántas filas quedaron afuera («Se omitieron N filas con error») y deja un registro
en **Actividad** (`stock.carga_inicial`) con el depósito, cuántas filas se aplicaron y cuántas se omitieron.

**Cargar dos veces no pasa.** Un producto que ya tuvo su carga inicial no la vuelve a tener: la fila queda con
error «Ya tuvo carga inicial», y si dos personas confirman a la vez la misma planilla, **una gana y la otra recibe
ese mismo mensaje**. Un reintento con la misma clave de envío no vuelve a mover stock.

**La planilla se lee en el navegador**: un archivo que no sea `.xlsx`, que esté vacío, que no tenga los encabezados
`sku` y `cantidad`, que tenga más de **2.000 filas** o que pese más de **5 MB** se rechaza con un mensaje claro y
**no hay vista previa**. Las filas en blanco se ignoran.

## Exportar stock y movimientos (F-STK-08)

El botón **«Exportar»** aparece en **Stock actual** (`/stock`) y en **Movimientos** (`/stock/movimientos`).

- Descarga un **CSV** con **exactamente las filas del filtro activo** (búsqueda, estado, «Ver solo alertas», depósito
  y producto según la pantalla), **no solo la página visible**, y con **las mismas columnas y encabezados que la
  tabla**, sin la columna de acciones.
- El archivo se llama `stock-actual-AAAA-MM-DD.csv` o `movimientos-stock-AAAA-MM-DD.csv`, con la fecha de hoy en la
  zona de la organización.
- Los valores que empiezan con `=`, `+`, `-` o `@` se **neutralizan**: el CSV abre bien en Excel y no ejecuta
  fórmulas.
- Mientras corre, el botón dice «Exportando…». Si algo falla, **no se descarga nada** y aparece un aviso con
  «Reintentar». Sin filas: se descarga el CSV solo con encabezados y se avisa «No hay filas para exportar».
- Se exporta con **lectura** o **edición** en Stock: exportar no escribe nada.
- Tope de **100.000 filas**: si hay más, se exportan las primeras y se pide afinar los filtros.

## Avisos de reposición (F-STK-09)

Un **resumen por correo** con los productos que **entraron en alerta** (estado «Stock bajo» o «Sin stock»), sin
tener que entrar al panel a mirarlos.

- **Qué es «nuevo en alerta»:** el producto está hoy en alerta y **no se avisó** todavía, o se avisó como «Stock
  bajo» y hoy está «Sin stock» (empeoró). Un producto que vuelve a «Disponible» pierde la marca y puede avisarse
  de nuevo cuando vuelva a caer.
- **Sin novedades, no hay correo**: si en la corrida no hay productos nuevos en alerta, no se genera ni se envía
  nada.
- **Contenido:** asunto con el total («N productos sin stock y M con stock bajo») y, por producto, nombre, SKU,
  stock, disponible, mínimo y estado. «Sin stock» primero y después por nombre. Hay un **tope de 50 productos**
  por correo, con el total y el enlace al panel.
- **Cuándo:** un barrido **diario** (por defecto, 9:00, hora del servidor de Kestra; se cambia en el YAML del
  flow).
- **Destinatarios:** los define el mecanismo de avisos de Plataforma (MSF-189). Mientras MSF-189 no esté
  disponible, el resumen va a los **miembros activos de la organización con edición en Stock**. Si no hay
  destinatarios, el resumen queda registrado como «sin destinatario» y **no marca productos como avisados**: se
  retoma en la corrida siguiente.
- **Si el envío falla**, el resumen queda registrado como fallido, **los productos no se marcan como avisados** y
  el reintento los vuelve a incluir.

## Faltantes con aviso de reposición (F-STK-17)

En **Stock → Faltantes** (`/stock/faltantes`) se ven las **líneas «A pedido» de facturas confirmadas** que esperan
mercadería.

- **Qué es un faltante:** una línea de factura confirmada «A pedido» cuya **reserva sigue activa**. No hay
  borrador ni presupuesto, y no hay línea con stock.
- **Se cierra solo:** cuando la reserva se descuenta (entrega) o se libera (la venta no se concretó), la línea
  desaparece de la lista. **No hay botón de cierre manual.**
- **Columnas:** Tienda · Cliente · Producto (nombre y SKU) · Pedido · Comprobante · Desde · Stock hoy · Aviso. Al pie,
  «N seleccionados de M faltantes» y «Un faltante se cierra solo cuando se ingresa la mercadería».
- **Avisar:** con filas seleccionadas, «Avisar a los seleccionados (N)» abre el diálogo «Avisar a los clientes»,
  que explica «Se envía un correo a N clientes con el detalle de los productos que volvieron a tener stock. Los
  faltantes avisados quedan marcados y no se vuelven a avisar». Con «Enviar avisos», el faltante queda **Avisado**
  y se encola **un correo por cliente** con todos sus faltantes.
- **A quién se avisa:** solo a los faltantes seleccionados cuyo producto **volvió a tener stock** (stock disponible
  hoy) y cuyo cliente **tiene correo**. Los demás se omiten y el aviso dice cuántos y por qué.
- **Un faltante ya avisado no se vuelve a avisar.** Si el correo falla y se agotan los reintentos, el faltante
  vuelve a «Sin avisar» y el error queda registrado.

## Reporte de productos más vendidos (F-STK-18)

En **Stock → Más vendidos** (`/stock/mas-vendidos`) se ve **qué productos se venden más en un período**.

- Tabla con **Posición · Producto (nombre y SKU) · Unidades vendidas**, ordenada por unidades descendente.
- **Período:** atajos «Este mes · Mes anterior · Últimos 90 días · Año en curso» y rango manual **Desde/Hasta**, con
  un rango máximo de 5 años. El período por defecto es el mes en curso.
- **Qué cuenta:** las **unidades** de las líneas de **facturas** del período. Las líneas «A pedido» también suman;
  **presupuestos, borradores y anuladas no suman**.
- **Tienda:** el filtro «Todas las tiendas» y la empresa activa de la barra superior acotan el reporte; una tienda
  ajena devuelve cero filas.
- Sin ventas en el período se ve el estado vacío «No hay ventas en el período».
- No hay prototipo de esta pantalla: se construyó con los componentes compartidos del panel.

## Permisos

| Acción | Quién puede |
|--------|-------------|
| Cargar stock por planilla (`/stock/excel`) | **Solo edición** en Stock |
| Exportar stock y movimientos | `lectura` o `edicion` en Stock |
| Ver Faltantes | `lectura` o `edicion` en Stock **y** ventas en `lectura`/`edicion` en la tienda |
| Avisar a los clientes de un faltante | `ventas` en **edición** en la tienda |
| Ver Más vendidos | `lectura` o `edicion` en Stock (los datos de venta, filtrados por las tiendas con ventas visible) |
| Recibir el resumen de reposición | Miembros activos con **edición** en Stock (destinatarios) |

La base es la autoridad: sin permiso, las RPC responden `42501` y `anon` no puede ejecutar nada.

## Empresa activa

**No aplica** en «Actualizar por Excel» ni en la exportación: el stock es **único y compartido** entre empresas y
canales, así que ninguna de las dos pantallas lee datos de una empresa.

**Sí aplica** en **Faltantes** y en **Más vendidos**: la lista y el reporte siguen la empresa activa de la barra
superior y el filtro «Tienda». Al cambiarla se invalidan las consultas, la paginación vuelve a la primera página,
la selección se descarta y **el diálogo «Avisar a los clientes» abierto se cierra con aviso**: nunca se muestran
filas ni totales de la empresa anterior.

## Límites y fuera de alcance

- La **carga inicial es una sola por producto**: después, el stock se corrige con movimientos, no con otra
  planilla inicial.
- La planilla **reemplaza** la cantidad del depósito elegido; no tiene modo «sumar a lo actual» (eso es «Carga en
  lote» y «Toma de inventario», de MSF-131). La exportación **no** exporta el reporte de más vendidos.
- El **resumen de reposición** no tiene pantalla de destinatarios ni de configuración: eso es de Plataforma
  (MSF-189).
- El **desglose por depósito** del chip «Stock hoy» de Faltantes no se muestra: el chip muestra el estado
  (Sin stock / Stock bajo / Disponible).
- La pantalla **no entrega ni descuenta** mercadería: solo lee el estado de la reserva. La entrega es de la épica
  de ventas (MSF-135/MSF-159).
- Faltantes **no es una tabla**: se deriva de las líneas de venta y sus reservas. Si otra épica define una tabla
  propia de faltantes, esta vista se reapunta.
- Los avisos **a clientes de la tienda web** que piden «avisame cuando vuelva» (pestaña «Avisos de la tienda
  web») son de otra épica.
- La exportación **no es un .xlsx**: es CSV. Y los lotes se piden por desplazamiento: si entran movimientos
  mientras corre, el archivo puede repetir o saltear una fila; para una foto exacta, se exporta de nuevo.

## Decisiones pendientes de confirmación

La épica cerró estas decisiones de la spec para poder implementarlas; quedan por confirmar con el dueño indicado:

| Decisión | Qué se implementó | Quién confirma |
|----------|-------------------|---------------|
| Hito y prioridad | P1 / Etapa 2. Si la carga inicial sube a P0, cambia el hito, no el alcance | Nicolás / producto |
| F-STK-07 y F-STK-17 «sin dibujar» en el documento de Stock | Sí tienen artboard (`StockExcel`, `VentasFaltantes`) y la spec se apoya en ellos | Nicolás / producto |
| «Modo» de la carga (reemplazar vs. sumar) | Solo **reemplazar**; «Sumar a lo actual» queda fuera de alcance | Nicolás / producto |
| Frecuencia del resumen de reposición | Una corrida **diaria**, con la hora editable en el YAML del flow | Nicolás / producto |
| Dueño de «faltantes» y del aviso | Esta épica es dueña de la **lectura derivada** y del **aviso**; no crea tabla `faltantes` | Nicolás / producto + MSF-135 |
| Qué es un faltante | Línea de **factura confirmada «A pedido»** con reserva activa; se cierra solo | Nicolás / producto |
| A quién se avisa | Solo faltantes **con stock hoy** y **con correo**; el resto se omite y se informa | Nicolás / producto |

## Para seguir

- **[Guía técnica de carga, exportación y avisos](../tecnico/stock-carga-exportacion-y-avisos.md)** — tablas, RPC,
  vistas, funciones, flows, pruebas y reversión.
- **[Stock: movimientos, historial y mínimo](../stock.md)** — el resto de la sección Stock.
- **[Stock · depósitos y reservas](stock-depositos-y-reservas.md)** — el nivel depósito que usa la carga inicial.
- Spec de la épica: `specs/20261024-130000-stock-carga-exportacion-y-avisos/`.
