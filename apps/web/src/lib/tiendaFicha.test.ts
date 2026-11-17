import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { leerFichaProducto } from './tiendaFicha'

const ID = '123e4567-e89b-42d3-a456-426614174000'
const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID, nombre: 'Joystick', descripcion: 'Control inalámbrico', sku: 'J-1', categoria: { id: 'c1', nombre: 'Controles' },
  precio: '1500.5', disponible: true, compatibilidad: null, imagenes: [{ posicion: 2, ruta: 'b.jpg' }, { posicion: 1, ruta: 'a.jpg' }], ...extra,
})

describe('leerFichaProducto', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('un id que no es UUID no llega a la base', async () => {
    await expect(leerFichaProducto('tienda.test', 'no-uuid')).resolves.toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('devuelve null si la base no encuentra el producto y lanza si falla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(leerFichaProducto('tienda.test', ID)).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('producto_por_dominio', { host: 'tienda.test', producto: ID })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(leerFichaProducto('tienda.test', ID)).rejects.toThrow('boom')
  })

  it('convierte precios a número y ordena las imágenes por posición', async () => {
    mocks.rpc.mockResolvedValue({ data: fila({ precio_anterior: '2000' }), error: null })
    const ficha = await leerFichaProducto('tienda.test', ID)
    expect(ficha?.precio).toBe(1500.5)
    expect(ficha?.precioAnterior).toBe(2000)
    expect(ficha?.imagenes.map((i) => i.ruta)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('sin promoción no trae precioAnterior; precio nulo y sin imágenes se respetan', async () => {
    mocks.rpc.mockResolvedValue({ data: fila({ precio: null, imagenes: null }), error: null })
    const ficha = await leerFichaProducto('tienda.test', ID)
    expect(ficha).not.toHaveProperty('precioAnterior')
    expect(ficha?.precio).toBeNull()
    expect(ficha?.imagenes).toEqual([])
  })

  it('omite la descripción cuando repite el nombre', async () => {
    mocks.rpc.mockResolvedValue({ data: fila({ descripcion: 'JOYSTICK' }), error: null })
    expect((await leerFichaProducto('tienda.test', ID))?.descripcion).toBeNull()
  })
})
