import { describe, expect, it } from 'vitest'
import { ESCALAS_PRECIO, leerEscalasPrecio } from './escalasPrecio'

describe('escalasPrecio', () => {
  it('declara los cuatro rangos fijos sin solaparse en orden creciente', () => {
    expect(ESCALAS_PRECIO.map((escala) => escala.clave)).toEqual(['x1', 'x5', 'x10', 'x50'])
    expect(ESCALAS_PRECIO.map((escala) => escala.rango)).toEqual(['1 a 4 u.', '5 a 9 u.', '10 a 49 u.', '50 u. o más'])
  })

  it('devuelve null (la ficha muestra «No disponible») mientras Precios no publique el contrato y no consulta la base', async () => {
    const rpc = () => { throw new Error('no debería llamarse') }
    await expect(leerEscalasPrecio({ rpc } as never, 'p-1')).resolves.toBeNull()
  })
})
