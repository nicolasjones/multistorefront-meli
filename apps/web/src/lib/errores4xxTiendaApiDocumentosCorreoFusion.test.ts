import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn(), from: vi.fn() } }))

import { mensajeDeFusion } from './clientes'
import { mensajeDeErrorImpresion } from './ventasImpresion'
import { mensajeDeErrorEnvio } from './ventasPresupuestoCorreo'

// Decimotercera ola (MSF-599): el servidor contesta `PT404` (404) donde antes contestaba `P0002` (500). Migración y despliegue de
// la web no son simultáneos: el cliente muestra lo mismo con los dos códigos. La tienda, las claves de API y la importación de
// productos se cubren en sus pruebas de pantalla (`api-suscripciones.test.tsx`, `carga-productos.test.tsx`).
const NO_EXISTE = ['P0002', 'PT404']

describe('decimotercera ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('impresión de comprobantes (%s): el comprobante ya no existe', (code) => {
    expect(mensajeDeErrorImpresion({ code, message: 'texto crudo' })).toBe('Ese comprobante no existe o no pertenece a tu organización.')
  })

  it.each(NO_EXISTE)('presupuesto por correo (%s): el presupuesto ya no existe', (code) => {
    expect(mensajeDeErrorEnvio({ code, message: 'texto crudo' })).toBe('Ese presupuesto no existe o no pertenece a tu organización.')
  })

  it.each(NO_EXISTE)('fusión de clientes (%s): muestra el mensaje de la base', (code) => {
    expect(mensajeDeFusion({ code, message: 'Alguno de los clientes no existe' })).toBe('Alguno de los clientes no existe')
  })

  it('el permiso sigue con 42501', () => {
    expect(mensajeDeErrorImpresion({ code: '42501' })).toMatch(/No tenés permiso/)
  })
})
