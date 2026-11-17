import { describe, expect, it } from 'vitest'
import {
  camposDelCambio,
  diaEnBuenosAires,
  etiquetaTipoActividad,
  formatearCuando,
  formatearDetalleActividad,
  quienDelEvento,
  rangoDelPeriodo,
} from './actividad'

describe('hora de Buenos Aires (F-AUD-01, FR-004)', () => {
  it('el día se calcula en Buenos Aires, no en UTC', () => {
    // 02:30 UTC del 1/10 todavía es 23:30 del 30/09 en Buenos Aires (UTC-3).
    expect(diaEnBuenosAires(new Date('2026-10-01T02:30:00Z'))).toBe('2026-09-30')
    expect(diaEnBuenosAires(new Date('2026-10-01T03:30:00Z'))).toBe('2026-10-01')
  })

  it('«Hoy» respeta el cambio de día de Buenos Aires', () => {
    const ahora = new Date('2026-10-01T02:30:00Z')
    expect(rangoDelPeriodo('hoy', ahora)).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' })
  })

  it('los últimos 7 y 30 días incluyen hoy', () => {
    const ahora = new Date('2026-10-10T15:00:00Z')
    expect(rangoDelPeriodo('7dias', ahora)).toEqual({ desde: '2026-10-04', hasta: '2026-10-10' })
    expect(rangoDelPeriodo('30dias', ahora)).toEqual({ desde: '2026-09-11', hasta: '2026-10-10' })
  })

  it('«todo el historial» no acota fechas', () => {
    expect(rangoDelPeriodo('todo')).toEqual({ desde: null, hasta: null })
  })

  it('muestra «Cuándo» como dd/mm/aaaa hh:mm en hora de Buenos Aires', () => {
    expect(formatearCuando('2026-10-01T03:30:00Z')).toBe('01/10/2026 00:30')
    expect(formatearCuando('2026-10-01T02:30:00Z')).toBe('30/09/2026 23:30')
  })
})

describe('«Quién» del evento (B2, FR-060)', () => {
  it('un evento con actor muestra su nombre', () => {
    expect(quienDelEvento('empresa.pausada', 'Ana Admin')).toBe('Ana Admin')
    expect(quienDelEvento('presupuesto.creado_desde_tienda', 'Ana Admin')).toBe('Ana Admin')
  })
  it('sin actor: «Tienda online» solo para el presupuesto pedido desde la tienda, «Sistema» para el resto', () => {
    expect(quienDelEvento('presupuesto.creado_desde_tienda', null)).toBe('Tienda online')
    expect(quienDelEvento('empresa.pausada', null)).toBe('Sistema')
    expect(quienDelEvento('comprobante.creado', null)).toBe('Sistema')
  })
})

describe('etiqueta del tipo', () => {
  it('traduce los tipos conocidos', () => {
    expect(etiquetaTipoActividad('usuario.rol_cambiado')).toBe('Cambio de rol')
    expect(etiquetaTipoActividad('empresa.creada')).toBe('Empresa creada')
  })

  it('traduce los eventos de las listas de precios', () => {
    expect(etiquetaTipoActividad('lista_precios.creada')).toBe('Lista de precios creada')
    expect(etiquetaTipoActividad('lista_precios.editada')).toBe('Lista de precios editada')
    expect(etiquetaTipoActividad('lista_precios.archivada')).toBe('Lista de precios archivada')
    expect(etiquetaTipoActividad('lista_precios.restaurada')).toBe('Lista de precios restaurada')
    expect(etiquetaTipoActividad('cliente.lista_precio_asignada')).toBe('Lista de precios del cliente')
    expect(etiquetaTipoActividad('newsletter.enviar')).toBe('Newsletter enviado')
    expect(etiquetaTipoActividad('newsletter.datos_borrados')).toBe('Datos de un suscriptor del newsletter borrados')
    expect(etiquetaTipoActividad('newsletter.baja')).toBe('Baja del newsletter desde el enlace')
    expect(etiquetaTipoActividad('newsletter.tope_confirmaciones')).toBe('Tope de confirmaciones por hora del newsletter alcanzado')
  })

  it('los tipos con formato interno salen con tildes', () => {
    expect(etiquetaTipoActividad('categoria.creada')).toBe('Categoría creada')
    expect(etiquetaTipoActividad('cuenta_cobro.creada')).toBe('Cuenta de cobro creada')
    expect(etiquetaTipoActividad('comprobante.nota_credito_emitida')).toBe('Nota de crédito emitida')
    expect(etiquetaTipoActividad('rma.stock_reingresado')).toBe('Stock reingresado')
    expect(etiquetaTipoActividad('stock.salida')).toBe('Salida de stock')
  })

  it('los tipos que antes caían en el respaldo salen con tildes y sin guion bajo', () => {
    expect(etiquetaTipoActividad('reparacion.creada')).toBe('Reparación creada')
    expect(etiquetaTipoActividad('cotizacion.cargada')).toBe('Cotización cargada')
    expect(etiquetaTipoActividad('despacho.envio_guardado')).toBe('Envío guardado')
    expect(etiquetaTipoActividad('campana_correo.baja')).toBe('Baja del correo masivo')
    expect(etiquetaTipoActividad('respuesta_rapida.creada')).toBe('Respuesta rápida creada')
    expect(etiquetaTipoActividad('consulta.asignada')).toBe('Consulta reasignada')
    expect(etiquetaTipoActividad('estado.creado')).toBe('Estado de reparación creado')
    expect(etiquetaTipoActividad('pago.conciliado')).toBe('Pago conciliado')
    expect(etiquetaTipoActividad('tienda.publicada')).toBe('Tienda publicada')
    expect(etiquetaTipoActividad('recalculo.aplicado')).toBe('Recálculo aplicado')
  })

  it('un tipo nuevo de otro componente se muestra legible', () => {
    expect(etiquetaTipoActividad('tema_nuevo.accion_rara')).toBe('Tema_nuevo accion rara')
  })
})

describe('importes del detalle con formato de moneda', () => {
  it('un cobro en pesos muestra el símbolo y los separadores', () => {
    expect(formatearDetalleActividad('Cobro de 859100 por Tarjeta de débito en la factura A-1')).toBe(
      'Cobro de $ 859.100,00 por Tarjeta de débito en la factura A-1',
    )
  })

  it('el cobro que trae la moneda escrita en el detalle usa el símbolo de esa moneda', () => {
    expect(formatearDetalleActividad('Cobro de ARS 859100 por Transferencia en la factura A-1')).toBe(
      'Cobro de $ 859.100,00 por Transferencia en la factura A-1',
    )
    expect(formatearDetalleActividad('Cobro de USD 100.50 por Transferencia en la factura A-1')).toBe(
      'Cobro de US$ 100,50 por Transferencia en la factura A-1',
    )
  })

  it('un importe con coma decimal también se formatea', () => {
    expect(formatearDetalleActividad('Cobro de 90919,40 por Efectivo en la factura A-1')).toBe(
      'Cobro de $ 90.919,40 por Efectivo en la factura A-1',
    )
  })

  it('formatea los importes con moneda escrita y los que ya traen símbolo', () => {
    expect(formatearDetalleActividad('Cambió el precio de lista de X: ARS 90919.40 → USD 12,5')).toBe(
      'Cambió el precio de lista de X: $ 90.919,40 → US$ 12,50',
    )
    expect(formatearDetalleActividad('Confirmó la cotización del dólar: $ 1250.5')).toBe(
      'Confirmó la cotización del dólar: $ 1.250,50',
    )
  })

  it('no toca los números que no son importes ni los importes ya formateados', () => {
    expect(formatearDetalleActividad('Descontó una reserva de 3 unidades')).toBe('Descontó una reserva de 3 unidades')
    expect(formatearDetalleActividad('Cobro de $ 1.250,50 por Transferencia en la factura A-1')).toBe(
      'Cobro de $ 1.250,50 por Transferencia en la factura A-1',
    )
  })
})

describe('campos del cambio (F-AUD-02, FR-007)', () => {
  it('da formato de moneda a los campos de importe del antes y después, y no toca los demás números', () => {
    expect(camposDelCambio({ total: '90919.40', cantidad: '12' }, { total: 859100, cantidad: '15' })).toEqual([
      { campo: 'Total', anterior: '90.919,40', nuevo: '859.100,00' },
      { campo: 'Cantidad', anterior: '12', nuevo: '15' },
    ])
  })

  it('arma campo por campo el antes y el después', () => {
    expect(camposDelCambio({ rol: 'Consulta' }, { rol: 'Mostrador' })).toEqual([{ campo: 'Rol', anterior: 'Consulta', nuevo: 'Mostrador' }])
  })

  it('un campo que existe de un solo lado muestra «—» del otro', () => {
    expect(camposDelCambio({ rol: 'Consulta', estado: 'Miembro' }, {})).toEqual([
      { campo: 'Rol', anterior: 'Consulta', nuevo: '—' },
      { campo: 'Estado', anterior: 'Miembro', nuevo: '—' },
    ])
    expect(camposDelCambio({}, { rol: 'Operador' })).toEqual([{ campo: 'Rol', anterior: '—', nuevo: 'Operador' }])
  })

  it('formatea booleanos y sin valores devuelve una lista vacía', () => {
    expect(camposDelCambio({ 'Operador · stock · eliminar': false }, { 'Operador · stock · eliminar': true })).toEqual([
      { campo: 'Operador · stock · eliminar', anterior: 'No', nuevo: 'Sí' },
    ])
    expect(camposDelCambio(null, null)).toEqual([])
  })
})
