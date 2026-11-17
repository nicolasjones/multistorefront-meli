import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { esRendible, mensajeDeErrorRendicion, mensajerosDeSeleccion, totalesDeSeleccion } from './enviosMotoRendicion'

describe('totales de la rendición de motos', () => {
  it('sin envíos todo es cero', () => {
    expect(totalesDeSeleccion([])).toEqual({ cantidad: 0, efectivoCobrado: 0, costoEnvios: 0, totalARendir: 0, neto: 0 })
  })

  it('suma abono y costo; el total a rendir es el efectivo y el neto resta el costo', () => {
    expect(totalesDeSeleccion([{ abono: 12000, costo_envio: 3500 }, { abono: 8000.5, costo_envio: 2500.25 }])).toEqual({
      cantidad: 2, efectivoCobrado: 20000.5, costoEnvios: 6000.25, totalARendir: 20000.5, neto: 14000.25,
    })
  })

  it('suma en centavos para no arrastrar errores de coma flotante', () => {
    const envios = Array.from({ length: 10 }, () => ({ abono: 0.1, costo_envio: 0.2 }))
    const totales = totalesDeSeleccion(envios)
    expect(totales.efectivoCobrado).toBe(1)
    expect(totales.costoEnvios).toBe(2)
    expect(totales.neto).toBe(-1)
  })

  it('el neto puede ser negativo cuando el costo supera lo cobrado', () => {
    expect(totalesDeSeleccion([{ abono: 0, costo_envio: 1500 }]).neto).toBe(-1500)
  })

  it('redondea al centavo importes con más decimales', () => {
    expect(totalesDeSeleccion([{ abono: 0.005, costo_envio: 0 }]).efectivoCobrado).toBe(0.01)
  })
})

describe('mensajeros de la selección', () => {
  it('agrupa sin distinguir mayúsculas ni espacios y conserva el primer nombre cargado', () => {
    expect(mensajerosDeSeleccion([{ mensajero: ' Juan Pérez ' }, { mensajero: 'JUAN   PÉREZ' }, { mensajero: 'juan pérez' }])).toEqual(['Juan Pérez'])
  })

  it('devuelve cada mensajero distinto en el orden en que aparece', () => {
    expect(mensajerosDeSeleccion([{ mensajero: 'Ana' }, { mensajero: 'Beto' }, { mensajero: 'ana' }])).toEqual(['Ana', 'Beto'])
  })

  it('una selección vacía no tiene mensajeros', () => {
    expect(mensajerosDeSeleccion([])).toEqual([])
  })
})

describe('qué envíos se pueden rendir', () => {
  it('solo los enviados, sin rendir y con permiso de rendir', () => {
    expect(esRendible({ enviado: true, rendido: false, puede_rendir: true })).toBe(true)
    expect(esRendible({ enviado: false, rendido: false, puede_rendir: true })).toBe(false)
    expect(esRendible({ enviado: true, rendido: true, puede_rendir: true })).toBe(false)
    expect(esRendible({ enviado: true, rendido: false, puede_rendir: false })).toBe(false)
  })
})

describe('errores de la rendición', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('la falta de rol pide ser Administrador; otro motivo del 42501 muestra el mensaje de la base', () => {
    expect(mensajeDeErrorRendicion({ code: '42501', message: 'Tu rol no puede rendir' }, 'x')).toContain('Solo el Administrador puede rendir')
    expect(mensajeDeErrorRendicion({ code: '42501', message: 'Necesitás una sesión con organización' }, 'x')).toContain('Solo el Administrador puede rendir')
    expect(mensajeDeErrorRendicion({ code: '42501' }, 'x')).toContain('Solo el Administrador puede rendir')
    expect(mensajeDeErrorRendicion({ code: '42501', message: 'Sos superadmin sin membresía en la tienda' }, 'x')).toBe('Sos superadmin sin membresía en la tienda')
  })

  it('el conflicto de edición pide recargar', () => {
    expect(mensajeDeErrorRendicion({ code: '40001' }, 'x')).toContain('Otra persona modificó estos envíos')
  })

  it('55000 y 22023 muestran el mensaje en castellano de la base; sin mensaje, el texto por defecto', () => {
    expect(mensajeDeErrorRendicion({ code: '55000', message: 'Factura anulada' }, 'x')).toBe('Factura anulada')
    expect(mensajeDeErrorRendicion({ code: '22023', message: 'Mezcla de mensajeros' }, 'x')).toBe('Mezcla de mensajeros')
    expect(mensajeDeErrorRendicion({ code: '55000' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorRendicion({ code: '22023' }, 'por defecto')).toBe('por defecto')
  })

  it('un error desconocido usa el texto por defecto y a la consola va solo el código', () => {
    expect(mensajeDeErrorRendicion(new Error('boom'), 'por defecto')).toBe('por defecto')
    expect(console.error).toHaveBeenCalledWith('por defecto', 'sin código')
  })
})
