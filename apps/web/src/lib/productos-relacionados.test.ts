import { describe, expect, it, vi } from 'vitest'
import {
  type Relacionado,
  buscarRelacionables,
  detalleRelacionado,
  etiquetaContador,
  filtroBuscadorRelacionados,
  guardarRelacionados,
  leerRelacionados,
  mensajeErrorRelacionados,
  moverRelacionado,
  parametrosGuardarRelacionados,
  relacionadosCambiaron,
} from './productos-relacionados'

const ITEM: Relacionado = { id: 'r1', nombre: 'Vidrio', sku: 'VID-1', categoria: 'Accesorios > Vidrios', precio: '1500.5', moneda: 'ARS' }

describe('productos-relacionados', () => {
  it('muestra «SKU · categoría · precio» y «—» cuando falta algo', () => {
    expect(detalleRelacionado(ITEM)).toBe('VID-1 · Accesorios > Vidrios · $ 1.500,50')
    expect(detalleRelacionado({ ...ITEM, moneda: 'USD', precio: 10 })).toBe('VID-1 · Accesorios > Vidrios · USD 10,00')
    expect(detalleRelacionado({ ...ITEM, sku: null, categoria: null, precio: null })).toBe('— · — · —')
  })

  it('el contador usa singular y plural', () => {
    expect(etiquetaContador(0)).toBe('0 productos')
    expect(etiquetaContador(1)).toBe('1 producto')
    expect(etiquetaContador(3)).toBe('3 productos')
  })

  it('mover intercambia posiciones y en los extremos no hace nada', () => {
    expect(moverRelacionado(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moverRelacionado(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moverRelacionado(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moverRelacionado(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })

  it('detecta cambios de contenido y de orden', () => {
    expect(relacionadosCambiaron(['a', 'b'], ['a', 'b'])).toBe(false)
    expect(relacionadosCambiaron(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(relacionadosCambiaron(['a'], ['a', 'b'])).toBe(true)
  })

  it('el filtro del buscador cubre nombre, SKU y categoría y sanea lo tipeado', () => {
    expect(filtroBuscadorRelacionados('   ')).toBeNull()
    expect(filtroBuscadorRelacionados('vidrio')).toBe('nombre.ilike.%vidrio%,sku.ilike.%vidrio%,categoria_ruta.ilike.%vidrio%')
    expect(filtroBuscadorRelacionados('a,b(c)*_%')).toBe('nombre.ilike.%a b c  \\_\\%%,sku.ilike.%a b c  \\_\\%%,categoria_ruta.ilike.%a b c  \\_\\%%')
  })

  it('el payload de guardado lleva los ids en el orden mostrado', () => {
    expect(parametrosGuardarRelacionados('p1', ['x', 'y', 'z'])).toEqual({ p_producto: 'p1', p_relacionados: ['x', 'y', 'z'] })
  })

  it('guarda por RPC y propaga el error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await guardarRelacionados({ rpc } as never, 'p1', ['x', 'y'])
    expect(rpc).toHaveBeenCalledWith('guardar_relacionados', { p_producto: 'p1', p_relacionados: ['x', 'y'] })
    const falla = { rpc: vi.fn().mockResolvedValue({ error: { code: '42501' } }) }
    await expect(guardarRelacionados(falla as never, 'p1', [])).rejects.toEqual({ code: '42501' })
  })

  it('lee los relacionados en el orden guardado', async () => {
    const returns = vi.fn().mockResolvedValue({
      data: [{ relacionado_id: 'r1', orden: 1, nombre: 'Vidrio', sku: 'VID-1', categoria: null, precio: 10, moneda: 'USD' }],
      error: null,
    })
    const order = vi.fn(() => ({ returns }))
    const eq = vi.fn(() => ({ order }))
    const cliente = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) }
    const filas = await leerRelacionados(cliente as never, 'p1')
    expect(cliente.from).toHaveBeenCalledWith('v_producto_relacionados')
    expect(eq).toHaveBeenCalledWith('producto_id', 'p1')
    expect(order).toHaveBeenCalledWith('orden', { ascending: true })
    expect(filas).toEqual([{ id: 'r1', nombre: 'Vidrio', sku: 'VID-1', categoria: null, precio: 10, moneda: 'USD' }])
  })

  describe('buscador', () => {
    const armar = (filas: unknown[], precios: unknown[] = []) => {
      const limit = vi.fn(() => ({ returns: vi.fn().mockResolvedValue({ data: filas, error: null }) }))
      const orden2 = vi.fn(() => ({ limit }))
      const orden1 = vi.fn(() => ({ order: orden2 }))
      const not = vi.fn(() => ({ order: orden1 }))
      const or = vi.fn(() => ({ order: orden1, not }))
      const inPrecios = vi.fn(() => ({ returns: vi.fn().mockResolvedValue({ data: precios, error: null }) }))
      const cliente = {
        from: vi.fn(() => ({ select: vi.fn(() => ({ or })) })),
        schema: vi.fn(() => ({ from: vi.fn(() => ({ select: vi.fn(() => ({ in: inPrecios })) })) })),
      }
      return { cliente, or, not, limit }
    }

    it('con texto vacío no consulta', async () => {
      const { cliente } = armar([])
      expect(await buscarRelacionables(cliente as never, '  ', [])).toEqual([])
      expect(cliente.from).not.toHaveBeenCalled()
    })

    it('tope 4, excluye propio y agregados y trae precio y moneda', async () => {
      const { cliente, not, limit } = armar(
        [{ id: 'r1', nombre: 'Vidrio', sku: 'VID-1', categoria_ruta: 'Accesorios' }],
        [{ id: 'r1', precio_lista: 10, moneda: 'USD' }],
      )
      const filas = await buscarRelacionables(cliente as never, 'vidrio', ['yo', 'ya'])
      expect(not).toHaveBeenCalledWith('id', 'in', '(yo,ya)')
      expect(limit).toHaveBeenCalledWith(4)
      expect(filas).toEqual([{ id: 'r1', nombre: 'Vidrio', sku: 'VID-1', categoria: 'Accesorios', precio: 10, moneda: 'USD' }])
    })

    it('sin coincidencias devuelve vacío sin leer precios', async () => {
      const { cliente } = armar([])
      expect(await buscarRelacionables(cliente as never, 'zzz', [])).toEqual([])
      expect(cliente.schema).not.toHaveBeenCalled()
    })
  })

  it('traduce los errores de la base a mensajes en castellano', () => {
    const silenciar = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeErrorRelacionados({ code: '42501' })).toMatch(/permiso/)
    expect(mensajeErrorRelacionados({ code: 'P0002' })).toMatch(/ya no existe/)
    expect(mensajeErrorRelacionados({ code: '22023' })).toMatch(/consigo mismo/)
    expect(mensajeErrorRelacionados(new Error('boom'))).toBe('No pudimos guardar los productos relacionados. Probá de nuevo.')
    silenciar.mockRestore()
  })
})
