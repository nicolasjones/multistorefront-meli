---
owner: producto
sources:
  - design/pantallas/Clientes.dc.html
  - design/pantallas/ClienteFicha.dc.html
---

# Clientes · ranking y compras (MSF-126)

Esta página explica **qué resuelve** la épica **MSF-126** (spec `ranking-de-clientes`) para quien opera el
negocio: ver qué clientes facturan más, exportar ese ranking y revisar las compras desde la ficha. El
detalle de datos, RPC y operación está en
[Clientes · ranking y compras (técnico)](../tecnico/ranking-de-clientes.md).

## Qué resuelve

- **Ranking de clientes por facturación (F-CLI-08):** en un rango de fechas, la lista de clientes ordenada
  por lo que facturaron, con la cantidad de comprobantes, el importe y la **participación** de cada uno
  sobre el total del ranking.
- **Exportar a Excel (F-CLI-09):** descargar **todas** las filas del ranking vigente, no solo la página que
  se está viendo, para analizarlo o compartirlo fuera del panel.
- **Compras en la ficha (F-CLI-10):** en la ficha de cada cliente, el total facturado del año y el listado
  de sus últimos comprobantes.

La épica **solo lee** los documentos de venta. No emite, edita ni anula comprobantes: eso es de Ventas
(MSF-159 y MSF-177).

## Para quién

- **Administrador, Administración, Operador y Mostrador:** ven el ranking y las compras de la ficha.
- **Consulta:** los ve en modo lectura.
- **Depósito:** no los ve (Clientes está en «ninguno» para ese rol en la matriz vigente).
- **Exportar a Excel:** además exige la acción **`exportar`** de Clientes (por defecto, Administrador,
  Operador y Administración). Sin esa acción, el botón no aparece.

## Cómo se usa el ranking

1. En **Clientes**, abrir la solapa **Ranking por facturación** (convive con **Listado**).
2. Elegir **Desde** y **Hasta** y pulsar **Aplicar**. Los atajos **Este mes**, **Mes anterior**,
   **Últimos 90 días** y **Año en curso** completan el rango y lo aplican.
3. La tabla muestra **#**, **Cliente**, **Tipo**, **Comprobantes**, **Facturado** y **Participación**. El
   nombre del cliente abre su ficha; la participación se acompaña de una barra proporcional al primero de
   la página.
4. Se puede acotar por **tipo de cliente** (Todos / Minorista / Mayorista), incluir o excluir al
   **Consumidor final** y ver los importes **con IVA** (por defecto se muestra **sin IVA**).
5. Con la acción `exportar`, **Exportar a Excel** descarga un `.xlsx` con las mismas filas y filtros del
   ranking, con progreso, opción de cancelar y reintento si falla.

### Qué cuenta como facturación

- Suma el **total de las facturas no anuladas** del cliente dentro del rango, por **fecha de emisión** y
  con los extremos **Desde** y **Hasta** incluidos.
- **Los presupuestos no cuentan** y las **facturas anuladas tampoco**. Ambos tampoco suman en la columna
  **Comprobantes**.
- El criterio exacto de estados lo fija Ventas y vive en **un solo lugar** del sistema; hoy una factura
  cuenta salvo que esté anulada (una factura en deuda sí cuenta).
- El **Consumidor final** arranca **excluido** del ranking (decisión provisoria, para no mezclar ventas
  anónimas de mostrador con clientes reales); se puede incluir con el interruptor.
- Los clientes **archivados** siguen contando por su facturación histórica.

## Compras en la ficha del cliente

- La ficha muestra **Compras** con **Resumen comercial**: el **total facturado del año en curso** (1 de
  enero al día de hoy), **sin IVA** y con el mismo criterio que el ranking.
- **Últimos comprobantes** lista número, fecha, estado y total, del más reciente al más antiguo, de a 10
  por página. Los presupuestos y las anuladas **se listan con su estado pero no suman** al total.
- Un cliente sin compras muestra «Este cliente todavía no tiene compras.» y un total de **$ 0**.
- Los números de comprobante son **texto** en esta entrega: el enlace al comprobante es de Ventas.
- El **Consumidor final** tiene la misma sección, como cualquier otro cliente.

## Empresa activa

- **Empresa activa: no aplica como filtro.** El ranking y las compras son **de toda la organización**, no de
  una tienda: no hay filtro ni desglose por tienda en esta entrega (ver *Fuera de alcance*).
- Al cambiar la empresa activa en la barra superior, la pantalla vuelve a consultar y descarta el estado de
  la empresa anterior; el resultado no cambia porque la lectura es por organización.

## Límites y fuera de alcance

- **Entrada oficial:** la solapa de **Clientes**. El mismo ranking dibujado en **Ventas · Reportes** (con
  filtro Tienda y desglose por tienda) **no** se implementa en esta épica; queda para las historias de
  Ventas (MSF-159/177).
- **Ranking avanzado** (F-CLI-14/15/16) es **MSF-171**, otra épica.
- **No usa Superset** ni dashboards: el ranking básico es una consulta del panel.
- **Rango máximo:** 5 años. Si Hasta es anterior a Desde, o faltan fechas, se muestra el error en el campo y
  no se consulta.
- **Exportación:** hasta **100.000 clientes**; si el ranking supera ese tope, pide acotar el período o los
  filtros. La exportación llama a la misma función que la pantalla, por lo que filas y totales coinciden.
- **Total con o sin IVA:** se entrega la opción «Ver con IVA»; la base por defecto es sin IVA (decisión
  provisoria, coherente con el margen).
- **Datos de venta:** si Ventas todavía no emitió comprobantes, el ranking y las compras se ven vacíos pero
  no fallan. Los datos de ejemplo existen solo en el entorno local.
- **No incluye** saldo deudor, «Nuevo comprobante» desde la ficha, contador de comprobantes, enlace al
  comprobante, correo masivo, etiquetas, importación ni cuenta web (otras épicas de Clientes).
- La ficha muestra el total **del año** (no «Facturado en 12 meses», que era el texto del prototipo).

## Estado

Funcionalidad implementada y liberada a **STG** en el lote de la épica (commit `3bd79c7d`); al escribir
esta página todavía no está integrada a `main`. Confirmá la rama vigente antes de operar producción.

## Para seguir

- [Clientes](../clientes.md) — alta, búsqueda, tipos, Consumidor final y exportación del listado.
- [Clientes · ranking y compras (técnico)](../tecnico/ranking-de-clientes.md) — datos, RPC, permisos y
  reversión.
- [Ventas · comprobantes](ventas-comprobantes.md) — quién emite los documentos que lee el ranking.
