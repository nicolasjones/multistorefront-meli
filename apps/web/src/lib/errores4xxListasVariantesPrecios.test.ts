import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn(), from: vi.fn() } }))

import { mensajeErrorEdicionMasiva } from './edicionMasiva'
import { mensajeErrorLista } from './listasPrecios'
import { esConflicto, MENSAJE_CONFLICTO, mensajeErrorActualizacion } from './preciosMasivos'
import { mensajeErrorVariantes } from './productos-variantes'

// Duodécima ola (MSF-599): el servidor contesta `PT404` (404) y `PT412` (412) donde antes contestaba `P0002` y `40001` (500).
// Migración y despliegue de la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const NO_EXISTE = ['P0002', 'PT404']
const CONFLICTO = ['40001', 'PT412']

describe('duodécima ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('listas de precios (%s): la lista o el cliente ya no existe', (code) => {
    expect(mensajeErrorLista({ code, message: 'texto crudo' }, 'x')).toBe('La lista o el cliente ya no existe.')
  })

  it.each(CONFLICTO)('listas de precios (%s): otra persona modificó la lista', (code) => {
    expect(mensajeErrorLista({ code, message: 'texto crudo' }, 'x')).toBe('Otra persona modificó esta lista. Recargá la pantalla y probá de nuevo.')
  })

  it('listas de precios: la bandera apagada sigue con 55000', () => {
    expect(mensajeErrorLista({ code: '55000' }, 'x')).toMatch(/desactivadas/i)
  })

  it.each(NO_EXISTE)('variantes (%s): el producto ya no existe', (code) => {
    expect(mensajeErrorVariantes({ code, message: 'texto crudo' })).toBe('El producto ya no existe.')
  })

  it.each(CONFLICTO)('variantes (%s): el producto fue modificado', (code) => {
    expect(mensajeErrorVariantes({ code, message: 'El producto fue modificado por otra persona' })).toMatch(/modificado por otra persona/)
  })

  it('variantes: el 40001 de stock sigue mostrando el mensaje del servidor', () => {
    const mensaje = 'El stock de la variante cambió mientras editabas (ahora hay 6, vos viste 5): recargá la ficha'
    expect(mensajeErrorVariantes({ code: '40001', message: mensaje })).toBe(mensaje)
  })

  it.each(CONFLICTO)('precios masivos (%s): un producto cambió desde la vista previa', (code) => {
    expect(esConflicto({ code })).toBe(true)
    expect(mensajeErrorActualizacion({ code })).toBe(MENSAJE_CONFLICTO)
  })

  it.each(NO_EXISTE)('edición masiva (%s): un producto o la categoría ya no existe', (code) => {
    expect(mensajeErrorEdicionMasiva({ code })).toMatch(/ya no existe/)
  })
})
