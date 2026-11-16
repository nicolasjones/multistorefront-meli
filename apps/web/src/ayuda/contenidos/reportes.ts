import type { AyudaPorDestino } from '../tipos'

export const ayudaReportes: AyudaPorDestino = {
  'reportes-inventario': {
    titulo: 'Productos y stock',
    resumen:
      'Muestra cada producto con su cantidad y su estado. Quienes pueden ver costos en el resto del producto ven además el costo, el valor de cada producto y el valor total del inventario; el resto (por ejemplo, el rol Consulta) ve solo cantidades, también en el archivo que se descarga. Podés filtrar por producto o SKU, categoría y estado; el valor total se calcula solo con lo que dejás filtrado. Un producto sin costo aparece con su stock pero sin valor. Es un reporte de toda la organización, no de una empresa.',
    pasos: [
      'Abrí el reporte para ver todos los productos con su stock (y su valor, si podés ver costos).',
      'Filtrá por producto o SKU, categoría o estado para acotar la lista.',
      'Si podés ver costos, mirá el valor total del inventario: suma solo las filas filtradas.',
    ],
  },
  'reportes-reposicion': {
    titulo: 'Reposición',
    resumen:
      'Lista los productos sin stock o con stock bajo y cuánto falta para volver al mínimo, para que armes el pedido a tus proveedores. Los productos sin stock aparecen primero. Podés filtrar por producto, SKU, categoría, estado y proveedor. Este reporte no genera órdenes de compra: sirve para decidir qué pedir.',
    pasos: [
      'Abrí el reporte para ver qué productos necesitan reposición.',
      'Filtrá por proveedor para armar el pedido de cada uno.',
      'Fijate en el faltante sugerido de cada producto.',
    ],
  },
  'reportes-tableros': {
    titulo: 'Tableros analíticos',
    resumen:
      'Una galería de tableros ya armados para cruzar tus ventas, tus tiendas, tus categorías y tu margen. Elegís uno, lo ves dentro del panel y lo acotás por período y por tienda: la tienda de la barra superior queda preseleccionada. No armás ni editás tableros: cada uno trae sus propios filtros y cruces. Solo ves los datos de tu organización y de las tiendas a las que tenés acceso. El margen y el costo aparecen solo en el tablero de margen real.',
    pasos: [
      'Mirá qué cruces y filtros trae cada tablero y tocá «Abrir tablero» en el que te sirva.',
      'Elegí el período y la tienda; el tablero se actualiza con tu elección.',
      'Usá los filtros propios del tablero (categoría, estado, agrupar por día, semana o mes) para afinar el análisis.',
      'Volvé a la galería con «Volver a los tableros» para abrir otro.',
    ],
  },
}
