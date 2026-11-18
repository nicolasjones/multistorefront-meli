import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  definicionEstado, esConflictoDeEstado, esEstadoDeCobro, ESTADOS_COMPROBANTE, ESTADOS_DE_LA_TARJETA, etiquetaEstadoComprobante, MENSAJE_CONFLICTO_ESTADO,
  MENSAJE_ERROR_CAMBIO_ESTADO, mensajeDeCambioEstado, MOTIVO_ESTADO_ANULADA, MOTIVO_ESTADO_BORRADOR, MOTIVO_ESTADO_DE_COBRO, motivoDeshabilitado,
  type EstadoComprobante,
} from './estadosComprobante'

describe('ayudas de stock coherentes con la confirmación', () => {
  it('ningún estado dice que el stock se descuenta recién al entregar: la confirmación ya descuenta', () => {
    for (const estado of Object.values(ESTADOS_COMPROBANTE)) {
      expect(estado.ayuda).not.toMatch(/todavía no se descuenta|sigue reservado/)
    }
    expect(ESTADOS_COMPROBANTE.confirmada.ayuda).toMatch(/ya se descontó al confirmar/)
    expect(ESTADOS_COMPROBANTE.confirmada.ayuda).toMatch(/«A pedido»/)
  })
})

describe('catálogo de estados del comprobante', () => {
  it('«confirmada» se muestra como «Pendiente», igual que el estado «pendiente»', () => {
    expect(etiquetaEstadoComprobante('confirmada')).toBe('Pendiente')
    expect(etiquetaEstadoComprobante('pendiente')).toBe('Pendiente')
  })

  it('cada estado tiene etiqueta, tono y ayuda no vacíos', () => {
    for (const [estado, definicion] of Object.entries(ESTADOS_COMPROBANTE)) {
      expect(definicion.etiqueta, estado).not.toBe('')
      expect(definicion.tono, estado).not.toBe('')
      expect(definicion.ayuda, estado).not.toBe('')
    }
  })

  it('un estado desconocido se muestra con su valor crudo y tono neutro, sin romper', () => {
    expect(definicionEstado('entregado_raro')).toEqual({ etiqueta: 'entregado_raro', tono: 'neutral', ayuda: '' })
    expect(etiquetaEstadoComprobante('')).toBe('')
  })

  it('un nombre heredado de Object no se toma por un estado', () => {
    for (const nombre of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(definicionEstado(nombre), nombre).toEqual({ etiqueta: nombre, tono: 'neutral', ayuda: '' })
    }
  })

  it('la tarjeta del detalle ofrece los estados en el orden del prototipo y todos existen en el catálogo', () => {
    expect(ESTADOS_DE_LA_TARJETA).toEqual(['confirmada', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto'])
    for (const estado of ESTADOS_DE_LA_TARJETA) expect(Object.keys(ESTADOS_COMPROBANTE), estado).toContain(estado)
  })

  it('solo Cobrado y Deuda son estados que se actualizan con el cobro', () => {
    expect(['cobrado', 'deuda'].every(esEstadoDeCobro)).toBe(true)
    expect(['borrador', 'confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'anulada', ''].some(esEstadoDeCobro)).toBe(false)
  })
})

describe('por qué un estado de la tarjeta está deshabilitado', () => {
  const permitidos = ['aceptado', 'en_proceso']

  it('el estado actual siempre se puede «elegir» (no hay motivo)', () => {
    expect(motivoDeshabilitado('aceptado', 'aceptado', [])).toBeNull()
    expect(motivoDeshabilitado('borrador', 'borrador', [])).toBeNull()
    expect(motivoDeshabilitado('cobrado', 'cobrado', [])).toBeNull()
  })

  it('un borrador no cambia de estado hasta confirmarse', () => {
    expect(motivoDeshabilitado('borrador', 'aceptado', permitidos)).toBe(MOTIVO_ESTADO_BORRADOR)
  })

  it('una factura anulada no admite cambios', () => {
    expect(motivoDeshabilitado('anulada', 'aceptado', permitidos)).toBe(MOTIVO_ESTADO_ANULADA)
  })

  it('el borrador y la anulación tienen prioridad sobre el motivo de cobro', () => {
    expect(motivoDeshabilitado('borrador', 'cobrado', permitidos)).toBe(MOTIVO_ESTADO_BORRADOR)
    expect(motivoDeshabilitado('anulada', 'deuda', permitidos)).toBe(MOTIVO_ESTADO_ANULADA)
  })

  it('Cobrado y Deuda nunca se eligen a mano, aunque la base los listara como permitidos', () => {
    expect(motivoDeshabilitado('confirmada', 'cobrado', ['cobrado'])).toBe(MOTIVO_ESTADO_DE_COBRO)
    expect(motivoDeshabilitado('confirmada', 'deuda', ['deuda'])).toBe(MOTIVO_ESTADO_DE_COBRO)
  })

  it('un destino permitido por el rol se puede elegir', () => {
    expect(motivoDeshabilitado('confirmada', 'en_proceso', permitidos)).toBeNull()
  })

  it('un destino no permitido nombra el cambio con las etiquetas visibles', () => {
    expect(motivoDeshabilitado('confirmada', 'armando', permitidos)).toBe('Tu rol no puede pasar de Pendiente a Armando.')
    expect(motivoDeshabilitado('aceptado', 'incompleto' as EstadoComprobante, [])).toBe('Tu rol no puede pasar de Aceptado a Incompleto.')
  })
})

describe('errores al cambiar el estado', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('el conflicto de edición (40001) pide recargar y se reconoce por separado', () => {
    expect(esConflictoDeEstado({ code: '40001' })).toBe(true)
    expect(esConflictoDeEstado({ code: '22023' })).toBe(false)
    expect(esConflictoDeEstado(null)).toBe(false)
    expect(mensajeDeCambioEstado({ code: '40001', message: 'could not serialize' })).toBe(MENSAJE_CONFLICTO_ESTADO)
  })

  it.each([
    ['42501', 'Tu rol no puede pasar de Pendiente a Armando'],
    ['55000', 'La factura está anulada y no admite cambios'],
    ['22023', 'Cobrado y Deuda no se cambian a mano'],
    ['22023', 'Un presupuesto no tiene estados de cobro'],
    ['22023', 'El estado "xyz" no existe'],
  ])('un %s con el mensaje en castellano de la RPC se muestra tal cual (%s)', (code, message) => {
    expect(mensajeDeCambioEstado({ code, message })).toBe(message)
  })

  it('un mensaje técnico en inglés no se expone aunque venga con un código conocido', () => {
    expect(mensajeDeCambioEstado({ code: '42501', message: 'permission denied for function cambiar_estado_comprobante' })).toBe(MENSAJE_ERROR_CAMBIO_ESTADO)
  })

  it('un mensaje de la RPC con un código no previsto tampoco se muestra', () => {
    expect(mensajeDeCambioEstado({ code: 'P0001', message: 'Tu rol no puede cambiar' })).toBe(MENSAJE_ERROR_CAMBIO_ESTADO)
  })

  it('comprobante inexistente y errores desconocidos', () => {
    expect(mensajeDeCambioEstado({ code: 'P0002' })).toBe('Ese comprobante no existe o no pertenece a tu organización.')
    expect(mensajeDeCambioEstado(new Error('red caída'))).toBe(MENSAJE_ERROR_CAMBIO_ESTADO)
    expect(mensajeDeCambioEstado(null)).toBe(MENSAJE_ERROR_CAMBIO_ESTADO)
  })

  it('el detalle del error queda en la consola', () => {
    const error = { code: 'XX000', message: 'interno' }
    mensajeDeCambioEstado(error)
    expect(console.error).toHaveBeenCalledWith(MENSAJE_ERROR_CAMBIO_ESTADO, error)
  })
})
