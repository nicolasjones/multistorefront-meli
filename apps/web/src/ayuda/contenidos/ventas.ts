import type { AyudaPorDestino } from '../tipos'

export const ayudaVentas: AyudaPorDestino = {
  'ventas-mostrador': {
    titulo: 'Venta de mostrador',
    resumen:
      'Sirve para vender rápido en el mostrador con un lector de código de barras. Cada producto que escaneás se suma a la venta como consumidor final, y al cobrar queda registrada la factura con su cobro. Hace falta permiso de edición en Ventas y una tienda elegida.',
    pasos: [
      'Elegí una tienda en la barra superior si tenés activas todas.',
      'Escaneá el código de barras de cada producto; si se repite, suma una unidad.',
      'Revisá el subtotal, el IVA y el total de la venta.',
      'Elegí la forma de pago (y la cuenta de cobro si te la pide) y tocá Cobrar.',
    ],
  },
  'ventas-comprobantes': {
    titulo: 'Comprobantes',
    resumen:
      'Es el listado de facturas y notas de crédito (las notas restan del saldo de su factura). Podés buscar por cliente o número, filtrar por operador, estado, pago, envío y tienda, y entrar a cada comprobante para ver su detalle. Desde acá también se crea un comprobante nuevo.',
    pasos: [
      'Escribí el cliente o el número en el buscador.',
      'Afiná con los filtros de operador, estado, pago y envío; usá Limpiar filtros para volver atrás.',
      'Tocá el número de un comprobante para abrir su detalle.',
      'Tocá Nuevo comprobante para cargar una venta.',
    ],
  },
  'ventas-presupuestos': {
    titulo: 'Presupuestos',
    resumen:
      'Lista los presupuestos que armaste para tus clientes. Podés buscarlos por cliente o número, filtrarlos por estado y, según el estado de cada uno, aceptarlo, copiarlo o modificarlo. También se pueden imprimir y enviar por correo.',
    pasos: [
      'Buscá por cliente o número, o filtrá por estado.',
      'Usá Aceptar cuando el cliente confirme el presupuesto.',
      'Usá Copiar o Modificar para armar una variante.',
      'Tocá Nuevo presupuesto para crear uno desde cero.',
    ],
  },
  'ventas-devoluciones': {
    titulo: 'Devoluciones',
    resumen:
      'Registra los reclamos y devoluciones de mercadería de una venta, ítem por ítem. Cada devolución indica cómo se resuelve (cambio directo, envío al proveedor, faltante en envío, reclamo de faltante o devolución de importe) y pasa por los estados Abierta, En gestión y Cerrada.',
    pasos: [
      'Tocá Nueva devolución y elegí el comprobante y el ítem.',
      'Indicá la cantidad, la forma de resolución y el motivo.',
      'Filtrá la lista por forma de resolución para seguir las pendientes.',
      'Avanzá el estado de cada devolución hasta cerrarla.',
    ],
  },
  transportes: {
    titulo: 'Transportes',
    resumen:
      'Es el catálogo de empresas de transporte y de sus terminales de retiro que usa tu organización para los envíos. También incluye los contrarreembolsos y los envíos en moto con mensajería propia. Todos los usuarios con acceso a Ventas pueden consultarlo; solo el Administrador carga o edita transportes. En Motos, registra envíos el Operador o el Administrador y rinde el Administrador.',
    pasos: [
      'Abrí la pestaña que necesitás: Contrarreembolsos, Motos o Terminales de retiro.',
      'Filtrá por tienda para ver los transportes que usa cada una.',
      'Si sos Administrador, creá o editá un transporte desde la lista.',
      'En Motos, Operador o Administrador tocan Registrar envío; solo el Administrador marca un envío como rendido, de a uno o en lote.',
    ],
  },
  'ventas-pagos': {
    titulo: 'Pagos',
    resumen:
      'Sirve para conciliar los cobros hechos por transferencia o depósito: los comparás con el extracto del banco y los marcás como cobrados. Si te equivocás, podés revertir la conciliación. Se puede filtrar por tienda y por cuenta de cobro. El saldo de «Solo con saldo» y de «Saldo pendiente de clientes» es el total menos lo cobrado y no descuenta las notas de crédito: puede ser mayor que el del comprobante.',
    pasos: [
      'Elegí la tienda y, si querés, una cuenta de cobro.',
      'Activá «Solo con saldo» para ver solo los pagos de comprobantes que todavía tienen saldo por cobrar.',
      'Cuando el pago figure en el extracto, activá el interruptor Cobrado.',
      'Si lo marcaste por error, desactivalo para revertir la conciliación.',
    ],
  },
  'ventas-configuracion': {
    titulo: 'Configuración de ventas',
    resumen:
      'Reúne los catálogos que se usan al cargar un comprobante, como las formas de pago y las formas de envío. Se configuran por empresa: elegí la empresa y trabajá en la pestaña que corresponda.',
    pasos: [
      'Elegí la empresa que querés configurar.',
      'Abrí la pestaña del catálogo: formas de pago o formas de envío.',
      'Cargá o editá los datos; las opciones que no usás las desactivás con el interruptor «Activo».',
    ],
  },
  'cuentas-cobro': {
    titulo: 'Cuentas de cobro',
    resumen:
      'Son las cuentas bancarias y billeteras donde cobrás las ventas por transferencia o depósito. Cada cuenta se habilita en las empresas que corresponda. Si una cuenta ya no se usa, se marca como No usar y conserva su historial. Solo el Administrador puede editarlas.',
    pasos: [
      'Revisá la lista de cuentas y sus datos.',
      'Si sos Administrador, creá una cuenta e indicá en qué empresas está disponible.',
      'Marcá No usar para dejar de ofrecer una cuenta; podés reactivarla cuando quieras.',
    ],
  },
  'ventas-reportes': {
    titulo: 'Reportes de ventas',
    resumen:
      'Muestra tableros para entender qué y a quién vendés, en cuatro pestañas: Más vendidos, Ranking de clientes, Productos más consultados y Ventas por período y canal. Cuentan las facturas y las notas de crédito (estas restan); no cuentan borradores, anuladas ni presupuestos. Necesitás permiso de Reportes.',
    pasos: [
      'Elegí el período y la tienda que querés analizar.',
      'Cambiá de pestaña según lo que quieras ver.',
      'En Ranking de clientes, usá «Exportar a Excel» si lo necesitás fuera del panel.',
    ],
  },
  'ventas-despacho': {
    titulo: 'Despacho',
    resumen:
      'Es el tablero de las facturas que hay que despachar, de solo lectura. Muestra el estado de cada una y los datos de transporte y guía. Por defecto ves todas las tiendas; si elegís una empresa en la barra superior, se filtra por ella.',
    pasos: [
      'Buscá una factura por cliente o número.',
      'Filtrá por estado de despacho.',
      'Revisá el transporte y la guía de cada factura.',
    ],
  },
  'ventas-faltantes': {
    titulo: 'Faltantes',
    resumen:
      'Lista, de solo lectura, los productos de ventas que no se pudieron despachar por falta de stock y siguen abiertos. Por defecto se ven todas las tiendas; si elegís una empresa en la barra superior, se filtra por esa tienda.',
    pasos: [
      'Elegí una empresa en la barra superior para ver solo su tienda.',
      'Revisá qué productos faltan y a qué venta corresponden.',
    ],
  },
  historial: {
    titulo: 'Historial',
    resumen:
      'Es un archivo de consulta con las ventas, los cobros y las cotizaciones del dólar de antes de usar la plataforma. Se importa desde una planilla del sistema anterior y después es solo lectura: no modifica el stock ni los comprobantes actuales.',
    pasos: [
      'Elegí la pestaña: Ventas, Cobros o Cotizaciones del dólar.',
      'En Ventas y Cobros buscá por cliente o número; en Cotizaciones del dólar, por fecha (dd/mm/aaaa).',
    ],
  },
}
