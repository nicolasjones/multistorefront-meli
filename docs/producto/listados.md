---
owner: producto
sources: []
---

# Cómo se muestran las listas

Casi todas las listas del sistema se cargan **por tandas**: al entrar a una pantalla ves los primeros resultados y,
cuando bajás hasta el final, se cargan los siguientes **sumándose a los que ya estabas viendo**. Ya no hay botones
de página ni la indicación «página 1 de 3».

Además, en las pantallas donde una fila hace referencia a un producto, el producto se muestra con su **foto chica**
al lado del nombre.

Esta página explica ese comportamiento. Después, cada pantalla tiene su propia página con el detalle de lo que hace.

## Cómo se cargan los resultados

- **Bajás y se cargan solos.** Cuando llegás cerca del final de la lista, se cargan los resultados siguientes sin que
  tengas que hacer nada.
- **O pulsás «Cargar más».** Al pie de la lista hay un botón **«Cargar más»**. Es la misma acción, pero a mano: sirve
  si preferís quedarte quieto, y se puede usar con el teclado (tabulá hasta el botón y pulsá Enter).
- **Cuando se acaba**, abajo aparece «No hay más resultados.» y el botón desaparece.
- **El contador de arriba no se miente.** Arriba, junto al buscador, sigue diciendo cuántos hay en total (por ejemplo,
  «57 clientes»), aunque todavía hayas visto sólo una parte.

## Si algo sale mal

Si al cargar una tanda más la conexión falla o el servidor no responde, la lista **no se borra**: queda todo lo que ya
habías cargado y abajo aparece un aviso con un botón **«Reintentar»**. Si apretás «Reintentar», se vuelve a pedir esa
tanda.

## Buscar, filtrar y ordenar

Cuando escribís en el buscador, elegís un filtro o cambiás el orden, la lista **vuelve a empezar desde el principio**:
se descartan los resultados que estaban cargados y se muestra la primera tanda con el nuevo criterio. Lo mismo pasa al
cambiar la **empresa activa** en la barra superior: la lista se reinicia y no quedan filas de la empresa anterior.

## La foto de los productos

En las pantallas donde una fila hace referencia a un producto, el producto se muestra con su **foto chica** al lado del
nombre. Hoy se ve en: **Stock** (stock actual, movimientos, faltantes, más vendidos, toma de inventario e
ingreso de mercadería), **Consultas**, los **productos de un proveedor**, los **repuestos de una reparación**, las
**líneas de un comprobante** y la tabla «Así quedan los precios».

- Si el producto **no tiene foto**, en su lugar se ve un recuadro vacío del mismo tamaño.
- **Pasá el mouse por la foto** y aparece la imagen **ampliada** al costado. La fila no cambia de tamaño.
- La foto que se muestra es la **principal** del producto (la primera que cargaste).
- Las filas que no son de un producto (clientes, comprobantes, pagos, consultas sin producto, cuentas de cobro) **no**
  llevan foto.

## Lo que no cambia

- **Exportar** sigue trayendo **todas** las filas del filtro que tengas aplicado, no sólo las que ya cargaste.
- **Los filtros y el orden** siguen siendo los mismos: los resultados se piden al servidor con el filtro aplicado.
- **Los totales** (por ejemplo, el número de comprobantes o de clientes) siguen siendo los del filtro completo.
- **Recargar la pantalla** (F5) vuelve a empezar por la primera tanda, como antes.

## Dónde se aplica

Este comportamiento está en la mayoría de las listas del sistema:

| Área | Pantallas |
|---|---|
| **Catálogo** | [Productos](catalogo-productos.md) |
| **Stock y compras** | [Stock](stock-movimientos.md) · [Ingreso de mercadería](ingreso-de-mercaderia.md) · [Lotes e inventario](stock-lotes-e-inventario.md) · [Carga inicial, exportación y avisos](stock-carga-exportacion-y-avisos.md) · [Proveedores](proveedores.md) |
| **Ventas** | [Presupuestos y facturas](ventas-comprobantes.md) · [Listado, estados y anulación](ventas-listado-estados-y-anulacion.md) · [Cobros y conciliación](ventas-cobros-y-conciliacion.md) · [Despacho y faltantes](ventas-despacho-y-faltantes.md) · [Devoluciones y reclamos](ventas-rma-devoluciones.md) · [Historial de ventas y cobros](ventas-historial-consulta.md) |
| **Clientes** | [Clientes](clientes.md) · [Ranking de clientes](ranking-de-clientes.md) · [Ranking avanzado](ranking-avanzado-de-clientes.md) · [Correo masivo](correo-masivo-a-clientes.md) |
| **Service técnico** | [Reparaciones, ítems e impresión](service-listado-items-impresion.md) · [Repuestos y stock](service-repuestos-y-stock.md) |
| **Tiendas y consultas** | [Consultas](consultas.md) · [Contactos](contactos.md) |
| **Administración** | [Actividad](actividad.md) · [Precios y dólar](precios-dolar.md) · [Precios, escalas e IVA](precios-e-iva.md) |

## Las listas que son distintas

- La **tienda online** (la que ven tus clientes) sigue con su paginación propia: se puede compartir un enlace a una
  página concreta del catálogo. El panel es el que cambió.
- El **historial de cargas del dólar** (Administración → Cotización del dólar) conserva los botones **Anterior** y
  **Siguiente**: se recorre carga por carga, hacia atrás y hacia adelante.
- El **historial de lotes** (Stock › Lotes e inventario) conserva su botón **«Ver más»**: pide los lotes anteriores
  de a uno.

## Si algo no se ve como contás

Si una lista te muestra algo que no coincide con lo que dice esta página, anotá la pantalla, qué estabas buscando y qué
viste, y avisale a quien administra el sistema: puede ser un detalle a corregir.
