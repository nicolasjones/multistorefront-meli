// Datos del módulo 05 (ventas, cobros, despacho y RMA): cuántos comprobantes de cada tipo, cómo se reparten y los
// textos libres (motivos, conceptos, observaciones). Todo lo que sea azar sale de `ctx.azar` en el módulo.

// Casos de factura: cuántas de cada una. Cada caso define hasta dónde llega la venta en su ciclo de vida
// (ver `modulos/05-ventas.mjs`). El orden de los pasos importa por una regla de la base: al cobrarse (o quedar en
// deuda) una factura deja de estar «confirmada» y el despacho ya no la acepta, así que se despacha ANTES de cobrar.
export const CASOS_FACTURA = {
  entregada_cobrada: 40, // se arma, se controla, se entrega y se cobra completa (en uno o dos cobros)
  entregada_deuda: 8, // mayoristas que retiran/reciben y pagan a cuenta: quedan con deuda (2 la saldan después)
  pendiente: 9, // confirmada, sin armar todavía (algunas con una seña en efectivo)
  armando: 6,
  incompleta: 5, // faltantes de despacho abiertos
  faltante_resuelto: 4, // tuvieron faltante, se reanudó el armado y se resolvió
  lista: 6, // listo para despachar (algunas con transporte y guía ya cargados)
  estado_documental: 8, // Aceptado / En proceso / Armando / Incompleto del estado del comprobante (no del despacho)
  contrarreembolso: 9, // cobra el transporte al entregar (la apertura y el cobro del contrarreembolso son del paso SQL 91)
  anulada: 8, // 3 con cobro parcial registrado, 5 sin cobros
  borrador: 6, // abandonados: sin líneas, con líneas y uno al que no le alcanza el stock
  pedido: 2, // PlayStation 5 Pro «A pedido»: reserva activa y reserva descontada al entregar
  convertida: 6, // la factura que salió de un presupuesto aceptado (no hay RPC de conversión: se arma igual)
}

// Presupuestos (sin los copiados, que salen de copiar un vencido).
export const CASOS_PRESUPUESTO = { vencido: 10, vigente: 7, aceptado: 6, convertido: 6 }
export const PRESUPUESTOS_COPIADOS = 3

// Cuántas facturas entregadas y cobradas reciben nota de crédito y cuántas una devolución (RMA).
export const NOTAS_CREDITO = [
  ['devolucion_productos', 4],
  ['devolucion_importe', 2],
  ['descuento', 2],
]
// [forma, estado final] de cada RMA: cubre las cinco formas y los tres estados.
export const RMA_PLAN = [
  ['cambio_directo', 'abierto'], ['cambio_directo', 'cerrado'],
  ['enviado_a_proveedor', 'en_gestion'], ['enviado_a_proveedor', 'abierto'],
  ['faltante_envio', 'en_gestion'], ['faltante_envio', 'cerrado'],
  ['reclamo_faltante', 'abierto'], ['reclamo_faltante', 'en_gestion'],
  ['devolucion_importe', 'cerrado'], ['devolucion_importe', 'abierto'],
]

// Peso de cada rubro raíz al armar el carrito de un minorista y de un mayorista (los mayoristas no compran consolas).
export const PESO_RUBRO_MINORISTA = {
  'Consolas de juegos': 2, 'Accesorios videojuegos': 6, 'Repuestos videojuegos': 3, 'Herramientas': 1.5,
  'Accesorios celulares': 4, 'Belleza': 2, 'Outlet': 1.5, 'Novedades en USD': 1,
}
export const PESO_RUBRO_MAYORISTA = {
  'Accesorios videojuegos': 5, 'Repuestos videojuegos': 5, 'Herramientas': 1.5, 'Accesorios celulares': 5, 'Belleza': 3, 'Outlet': 1,
}
// Qué fracción del stock disponible se puede vender en toda la siembra: el resto queda para reservas, el módulo de
// service (usa repuestos) y para que el listado de stock siga teniendo variedad.
export const FRACCION_VENDIBLE = { 'Consolas de juegos': 0.4, 'Repuestos videojuegos': 0.4, 'Herramientas': 0.5, default: 0.55 }

export const CANALES_RETIRO = [['mostrador', 6], ['telefono_whatsapp', 2], ['tienda_online', 1]]
export const CANALES_ENVIO = [['tienda_online', 5], ['telefono_whatsapp', 4], ['mostrador', 1]]

// Prefijos de guía por transporte (ficticios).
export const PREFIJO_GUIA = { cuyano: 'CY', patagonia: 'PS', plata: 'CP', litoral: 'CL', nortenio: 'NV', noreste: 'UN', moto_jc: 'MJ' }

export const MOTIVOS_ANULACION_VENTA = [
  'El cliente se arrepintió antes del retiro',
  'Error de carga: el cliente era otro',
  'Se facturó dos veces el mismo pedido',
  'El cliente pidió otro modelo y se hizo una factura nueva',
  'Pago rechazado por el banco, el cliente no respondió',
  'Pedido duplicado desde la tienda online',
  'Producto equivocado en la factura, se rehízo',
  'El cliente canceló la compra por demora en el envío',
]
export const CONCEPTOS_NC = {
  devolucion_importe: ['Devolución del importe: producto con falla de fábrica', 'Devolución parcial acordada con el cliente por faltante en el envío'],
  descuento: ['Bonificación por demora en la entrega', 'Descuento comercial acordado después de facturar'],
}
export const MOTIVOS_RMA = {
  cambio_directo: ['Joystick con drift: se cambia por uno nuevo', 'Llegó con otro color al pedido: se cambia en el momento'],
  enviado_a_proveedor: ['Falla de fábrica: se envía al proveedor para garantía', 'Consola no enciende: va a garantía del proveedor'],
  faltante_envio: ['Faltó un producto en la caja que despachó el expreso', 'El paquete llegó abierto y sin un accesorio'],
  reclamo_faltante: ['El cliente reclama una unidad que no llegó', 'Reclamo por cantidad menor a la facturada'],
  devolucion_importe: ['El cliente devuelve el producto y se le reintegra el importe', 'Producto no compatible: reintegro del importe'],
}
export const OBSERVACIONES_RMA = [
  'Se pidió foto del embalaje al cliente.', 'Pendiente de respuesta del proveedor.', 'El cliente retira el reemplazo en el local.',
  'Se coordinó el retiro con el expreso.', null, null, 'Se verificó el número de serie.',
]
