import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn(), from: vi.fn() } }))

import { mensajeDeErrorCosto } from './costosAdicionales'
import { mensajeDeFusion } from './clientes'
import { mensajeDeErrorImpresion } from './ventasImpresion'
import { mensajeDeErrorComprobante } from './ventas'
import { mensajeDeErrorBase } from './mensajeErrorBase'

// Decimocuarta ola (MSF-599): el servidor contesta `PT404` (404) donde antes contestaba `P0002` (500). Migración y despliegue de
// la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const NO_EXISTE = ['P0002', 'PT404']

describe('decimocuarta ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('costos adicionales (%s): el costo ya no existe', (code) => {
    expect(mensajeDeErrorCosto({ code })).toBe('Este costo ya no existe. Actualizá la lista.')
  })

  it.each(NO_EXISTE)('impresión de comprobantes (%s): el documento ya no existe', (code) => {
    expect(mensajeDeErrorImpresion({ code, message: 'texto crudo' })).toBe('Ese comprobante no existe o no pertenece a tu organización.')
  })

  it.each(NO_EXISTE)('copiar presupuesto (%s): el presupuesto ya no existe', (code) => {
    expect(mensajeDeErrorComprobante({ code, message: 'texto crudo' }, 'No pudimos copiar.')).toBe(
      'Ese comprobante no existe o no pertenece a tu organización.',
    )
  })

  it.each(NO_EXISTE)('fusión de clientes (%s): muestra el mensaje de la base', (code) => {
    expect(mensajeDeFusion({ code, message: 'Alguno de los clientes no existe' })).toBe('Alguno de los clientes no existe')
  })

  it.each(NO_EXISTE)('conexiones, integraciones, reportes y funcionalidades (%s): mensaje genérico de «no existe»', (code) => {
    expect(mensajeDeErrorBase({ code, message: 'La conexión no existe' }, 'No pudimos completar la acción.')).toBe(
      'El dato que buscás ya no existe o no pertenece a tu organización.',
    )
  })

  it('el permiso sigue con 42501', () => {
    expect(mensajeDeErrorCosto({ code: '42501' })).toMatch(/Tu rol no puede editar/)
  })
})
