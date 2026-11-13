---
owner: producto
sources: []
---

# Reportes de ventas

## Para qué sirve

La pantalla **Reportes de ventas** reúne los informes para entender qué vendés, a quién y qué te consultan:

- **Más vendidos**: qué productos salieron más en un período y cuánto stock queda hoy.
- **Ranking de clientes**: quién compró más y cuándo fue su última compra, con exportación a Excel.
- **Productos más consultados**: qué productos reciben más consultas por WhatsApp.
- **Ventas por período y canal**: cómo evolucionan las ventas y cuánto factura cada tienda.

Los datos salen de los comprobantes confirmados y de las consultas que llegan desde las tiendas online. No hace falta armar planillas a mano.

## Quién puede hacerlo

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Ver las cuatro pestañas y exportar el ranking a Excel. |
| **Administración** | Ver las cuatro pestañas y exportar el ranking a Excel. |
| **Operador, Mostrador, Depósito, Técnico, Consulta y Miembro** | No acceden: ven el aviso «No tenés acceso a esta sección». |

La sección **Reportes** es por empresa: el nivel sale de la empresa activa. El Administrador puede cambiar esto en [Usuarios y roles](usuarios-y-roles.md).

## Dónde lo encontrás

En el menú de la izquierda: **Ventas → Reportes**. La pantalla tiene cuatro pestañas: **Más vendidos**, **Ranking de clientes**, **Productos más consultados** y **Ventas por período y canal**.

Arriba de las pestañas están los filtros que comparten los informes:

- **Tienda**: «Todas las tiendas» o una tienda concreta. Por defecto se ven todas; si elegís una empresa en la barra superior, el filtro se pone en esa tienda.
- **Período**: **Desde** y **Hasta**, con los atajos **Hoy**, **7 días**, **Este mes** y **Mes anterior**. Abre en **Este mes**. Si «Hasta» es anterior a «Desde», el campo lo avisa y el rango no se aplica.

El botón **Exportar a Excel** aparece en el encabezado solo cuando estás en **Ranking de clientes**.

## Pestaña Más vendidos

La tabla muestra, por producto:

| Columna | Qué es |
|---|---|
| **Producto** | Nombre del producto (con su SKU en una columna aparte). |
| **Unidades** | Unidades vendidas en el período. Las notas de crédito restan. |
| **Facturado** | Facturación del período con IVA. |
| **Stock hoy** | Stock actual del producto y su estado: sin stock, stock bajo o disponible. |

Los productos aparecen ordenados por unidades, de mayor a menor. El período y la tienda se toman de los filtros de arriba. Dentro del informe podés filtrar además por categoría y por ubicación del stock.

Si no hubo ventas en el período, ves «No hay ventas en ese período» y la ayuda «Probá con otro período o con otra tienda.».

## Pestaña Ranking de clientes

La tabla muestra, por cliente:

| Columna | Qué es |
|---|---|
| **Cliente** | Nombre del cliente, con su número y su tipo en columnas propias. |
| **Comprobantes** | Cantidad de facturas que cuentan en el período. Las notas de crédito restan del importe, pero no suman un comprobante. |
| **Facturado** | Facturación del período con IVA. |
| **Participación** | Porcentaje del cliente sobre el total del informe, con una barra proporcional. |
| **Último comprador** | Fecha del último comprobante que cuenta del cliente. |

El interruptor **Consumidor final** incluye o excluye al cliente «Consumidor final». Viene **excluido**: si lo encendés, aparece en el ranking; si lo apagás, desaparece.

Los clientes aparecen ordenados por facturación, de mayor a menor.

### Exportar a Excel

El botón **Exportar a Excel** está en el encabezado de la pantalla y aparece solo en esta pestaña.

- Genera un archivo `.xlsx` con el nombre `ranking-clientes-ventas-<desde>_<hasta>.xlsx`.
- Incluye **todas** las filas del ranking, no solo las que se ven en pantalla.
- Respeta los filtros vigentes: período, tienda y el interruptor **Consumidor final**.
- Muestra el progreso y se puede cancelar.
- Si el ranking está vacío, no descarga nada y avisa «No hay clientes en el ranking con esos filtros. Probá con otro período o activá el «Consumidor final».».
- Con más de 100.000 clientes en el alcance, no exporta: pedí acotar el período o los filtros.

## Pestaña Productos más consultados

Muestra los productos que más veces se consultaron por WhatsApp en el período:

| Columna | Qué es |
|---|---|
| **Producto** | Nombre del producto (con su SKU en una columna aparte). |
| **Consultas** | Veces que se tocó «Consultar por WhatsApp» para ese producto. |
| **Última consulta** | Fecha y hora de la consulta más reciente. |

- Los productos aparecen ordenados por cantidad de consultas, de mayor a menor.
- Cuenta cada toque en «Consultar por WhatsApp», no cada venta.
- Se toman el período y la tienda de los filtros de arriba.
- No muestra costo ni margen: son solo cantidades y fechas.
- Si no hubo consultas en el período, ves «No hay consultas por WhatsApp en ese período».

## Pestaña Ventas por período y canal

Muestra cómo se movieron las ventas en el período y cuánto facturó cada tienda:

- Un **gráfico de barras** con la facturación a lo largo del período, separada por empresa.
- Una **tabla por canal** con **Empresa**, **Facturado**, **Comprobantes** y **Unidades**.
- Podés elegir la agrupación del período: **día**, **semana** o **mes**.
- Se toman el período y la tienda de los filtros de arriba.
- Hoy los canales son las tiendas del negocio: Mercado Libre todavía no se incluye.
- Si no hubo ventas en el período, ves «No hay ventas en ese período».

## Qué cuenta como venta

Los informes de ventas usan el mismo criterio:

- Cuentan las **facturas** y las **notas de crédito** confirmadas. Los **presupuestos**, los **borradores** y los comprobantes **anulados** no cuentan.
- Las **notas de crédito restan** unidades e importe.
- El importe es el **total con IVA**, el mismo que muestra el listado de comprobantes.
- Un cliente que en el período solo tiene notas de crédito aparece con facturación negativa: se muestra el neto real, sin piso en cero.
- Un comprobante **sin tienda** no aparece en ningún informe.

## Empresa activa

El filtro **Tienda** sigue a la **empresa activa** de la barra superior:

- Por defecto se ven todas las tiendas a las que tenés acceso.
- Al elegir una empresa en la barra superior, el filtro de la pantalla queda en esa tienda.
- Al **cambiar de empresa**, el informe y el filtro se recargan, y no quedan filas de la empresa anterior.
- Si había una exportación en curso, se cancela.
- El archivo de Excel sale con los filtros de la tienda vigente.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **No hay ventas en ese período.** | Probá con otro período o con otra tienda. |
| **No hay consultas por WhatsApp en ese período.** | Probá con otro período o con otra tienda. |
| **No pudimos cargar el tablero de «…».** | Usá **Reintentar**. Si sigue fallando, avisá al equipo de soporte. |
| **El tablero de «…» todavía no está disponible para tu organización.** | Pedíselo al equipo de soporte. |
| **No tenés acceso a esta sección.** | Tu rol no incluye Reportes. Usá **Solicitar acceso** o pedile acceso al Administrador. |
| **No hay clientes en el ranking con esos filtros.** | Probá con otro período o activá el **Consumidor final**. |

## Para seguir

- [Comprobantes](ventas-comprobantes.md) — de dónde salen las ventas que se reportan.
- [Clientes](clientes.md) — el ranking de clientes y su ficha.
- [Consultas](consultas.md) — las consultas por WhatsApp que cuenta «Productos más consultados».
- [Rentabilidad](rentabilidad.md) — el margen de lo vendido y los costos adicionales.
- [Permisos por rol](../permisos-por-rol.md) — la sección Reportes de la matriz.
