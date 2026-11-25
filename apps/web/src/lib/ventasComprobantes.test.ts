import { describe, expect, it } from 'vitest'
import { OPCIONES_FILTRO_ESTADO } from './ventasComprobantes'

describe('OPCIONES_FILTRO_ESTADO', () => {
  it('ofrece Borrador y Anulada, que el listado ya sabe filtrar', () => {
    const porValor = Object.fromEntries(OPCIONES_FILTRO_ESTADO.map((o) => [o.valor, o.etiqueta]))
    expect(porValor.borrador).toBe('Borrador')
    expect(porValor.anulada).toBe('Anulada')
  })

  it('no ofrece Entregado', () => {
    expect(OPCIONES_FILTRO_ESTADO.map((o) => o.etiqueta)).not.toContain('Entregado')
  })
})
