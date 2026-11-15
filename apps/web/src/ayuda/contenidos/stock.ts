import type { AyudaPorDestino } from '../tipos'

export const ayudaStock: AyudaPorDestino = {
  stock: {
    titulo: 'Stock',
    resumen:
      'Muestra cuánto hay de cada producto: cantidad disponible, reservada, mínimo, estado y último movimiento. Con permiso de edición podés registrar movimientos, definir el mínimo y trasladar mercadería entre depósitos. Los administradores también gestionan los motivos de movimiento.',
    pasos: [
      'Buscá por nombre o SKU, o filtrá por estado y por depósito.',
      'Pulsá «Nuevo movimiento» para registrar una entrada, una salida o un ajuste.',
      'Usá «Editar mínimo» para definir desde qué cantidad el producto se considera con stock bajo.',
      'Pulsá «Trasladar» para pasar unidades de un depósito a otro.',
    ],
  },
  'stock-movimientos': {
    titulo: 'Movimientos',
    resumen:
      'Es el historial de todo lo que entró, salió o se ajustó en el stock: fecha, producto, depósito, cantidad, motivo, nota y quién lo registró. Es solo de consulta: los movimientos registrados no se modifican. También ofrece un resumen por producto.',
    pasos: [
      'Elegí un producto en «Filtrar por producto» para ver solo sus movimientos.',
      'Revisá el motivo, la nota y el responsable de cada movimiento.',
      'Mirá el bloque «Resumen por producto», arriba del historial, para ver lo que queda, lo reservado y lo disponible.',
    ],
  },
  'stock-ingresos': {
    titulo: 'Ingreso de mercadería',
    resumen:
      'Sirve para registrar la mercadería que llega de un proveedor: sube el stock y queda el historial de cada ingreso. Con permiso de edición en Stock podés cargar ingresos y anularlos con un motivo; con solo lectura ves el historial. Hay una pestaña aparte para consultar el archivo anterior al sistema.',
    pasos: [
      'Completá «Compra a nombre de» (la empresa), el proveedor, la fecha y el remito o factura de compra.',
      'Agregá cada producto con su cantidad y su costo unitario en USD.',
      'Pulsá «Registrar ingreso» para que el stock se actualice.',
      'Si te equivocaste, anulá el ingreso desde el historial indicando el motivo.',
    ],
  },
  'stock-depositos': {
    titulo: 'Depósitos de mercadería',
    resumen:
      'Lista los depósitos donde guardás mercadería, con su dirección, la cantidad de productos con stock, las unidades y qué empresas venden desde cada uno. Solo los administradores crean y editan depósitos; el resto puede consultarlos. Los depósitos no se borran: se desactivan.',
    pasos: [
      'Elegí la empresa en la barra superior para ver los depósitos desde los que vende.',
      'Pulsá «Nuevo depósito de mercadería» para crear uno.',
      'Pulsá «Usar por defecto» en el depósito principal: recibe los ingresos y aparece primero en los selectores.',
      'Para dejar de usar un depósito, apagá «Activo»; antes trasladá su stock. El depósito por defecto no se puede apagar.',
    ],
  },
}
