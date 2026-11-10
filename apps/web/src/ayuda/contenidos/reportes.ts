import type { AyudaPorDestino } from '../tipos'

export const ayudaReportes: AyudaPorDestino = {
  'reportes-inventario': {
    titulo: 'Productos y stock',
    resumen:
      'Muestra cada producto con su cantidad, su costo y su valor, y el valor total del inventario. Podés filtrar por producto o SKU, categoría y estado; el valor total se calcula solo con lo que dejás filtrado. Un producto sin costo aparece con su stock pero sin valor. Es un reporte de toda la organización, no de una empresa.',
    pasos: [
      'Abrí el reporte para ver todos los productos con su stock y su valor.',
      'Filtrá por producto o SKU, categoría o estado para acotar la lista.',
      'Mirá el valor total del inventario: suma solo las filas filtradas.',
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
}
