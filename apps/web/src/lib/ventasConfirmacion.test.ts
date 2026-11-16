import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))

import { esCambioDeLista, esFaltanteDeStock, esPreciosCambiaron, mensajeDeConfirmacion, MENSAJE_ERROR_CONFIRMAR } from './ventasConfirmacion'
import { MENSAJE_LISTA_CAMBIO_COBRO, MENSAJE_PRECIOS_CAMBIARON_COBRO } from './ventasLineas'

describe('esFaltanteDeStock', () => {
  it('reconoce P0001 con hint stock', () => {
    expect(esFaltanteDeStock({ code: 'P0001', hint: 'stock', message: 'No hay stock suficiente de X' })).toBe(true)
  })

  it('no toma por faltante un P0001 genérico de otra función', () => {
    const error = { code: 'P0001', message: 'error interno de registrar_actividad' }
    expect(esFaltanteDeStock(error)).toBe(false)
    expect(mensajeDeConfirmacion(error)).not.toContain('error interno')
    expect(mensajeDeConfirmacion(error)).toContain(MENSAJE_ERROR_CONFIRMAR.slice(0, 20))
  })
})

describe('precios_cambiaron (F-2, FR-018; el error lo emite el servidor en F-3)', () => {
  const error = { code: '40001', hint: 'precios_cambiaron', message: 'Los precios cambiaron' }

  it('reconoce 40001 con hint precios_cambiaron y lo traduce al aviso, antes del mapeo genérico', () => {
    expect(esPreciosCambiaron(error)).toBe(true)
    expect(mensajeDeConfirmacion(error)).toBe(MENSAJE_PRECIOS_CAMBIARON_COBRO)
  })

  it('distingue el cambio de la lista de precios (details = lista_precios) del de una promoción', () => {
    const porLista = { ...error, details: 'lista_precios' }
    expect(esPreciosCambiaron(porLista)).toBe(true)
    expect(esCambioDeLista(porLista)).toBe(true)
    expect(mensajeDeConfirmacion(porLista)).toBe(MENSAJE_LISTA_CAMBIO_COBRO)
    expect(esCambioDeLista(error)).toBe(false)
    expect(esCambioDeLista({ code: '40001', details: 'lista_precios' })).toBe(false)
  })

  it('un 40001 sin ese hint (conflicto de edición) o el hint con otro código NO es precios_cambiaron', () => {
    expect(esPreciosCambiaron({ code: '40001', message: 'otro usuario' })).toBe(false)
    expect(esPreciosCambiaron({ code: 'P0001', hint: 'precios_cambiaron' })).toBe(false)
    expect(esPreciosCambiaron(null)).toBe(false)
    expect(mensajeDeConfirmacion({ code: '40001', message: 'otro usuario' })).not.toBe(MENSAJE_PRECIOS_CAMBIARON_COBRO)
  })
})
