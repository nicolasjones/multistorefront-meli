import { beforeEach, describe, expect, it, vi } from 'vitest'

const limit = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['schema', 'from', 'select', 'eq', 'or', 'order']) cadena[metodo] = vi.fn(() => cadena)
  cadena.limit = (n: number) => ({ returns: () => limit(n) })
  return { supabaseClient: cadena }
})

import { buscarProductos, buscarProductosConAviso } from './reparacionItems'

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, nombre: `Cámara ${i}`, sku: null, disponibilidad_manual: null }))

describe('buscarProductosConAviso (MSF-722)', () => {
  beforeEach(() => limit.mockReset())

  it('pide uno más que el tope y avisa que hay más, devolviendo solo 20', async () => {
    limit.mockResolvedValue({ data: filas(21), error: null })
    const { productos, hayMas } = await buscarProductosConAviso('camara')
    expect(limit).toHaveBeenCalledWith(21)
    expect(productos).toHaveLength(20)
    expect(hayMas).toBe(true)
  })

  it('con exactamente 20 resultados no avisa', async () => {
    limit.mockResolvedValue({ data: filas(20), error: null })
    const { productos, hayMas } = await buscarProductosConAviso('camara')
    expect(productos).toHaveLength(20)
    expect(hayMas).toBe(false)
  })

  it('con texto vacío no consulta', async () => {
    expect(await buscarProductosConAviso('   ')).toEqual({ productos: [], hayMas: false })
    expect(limit).not.toHaveBeenCalled()
  })

  it('buscarProductos devuelve solo la lista', async () => {
    limit.mockResolvedValue({ data: filas(3), error: null })
    expect(await buscarProductos('camara')).toHaveLength(3)
  })
})
