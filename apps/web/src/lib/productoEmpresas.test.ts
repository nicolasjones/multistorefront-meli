import { describe, expect, it, vi } from 'vitest'
import { definirEmpresasProducto, empresasCambiaron, leerEmpresasProducto, notaVisibilidad } from './productoEmpresas'

describe('notaVisibilidad', () => {
  it('une los nombres con « y » o avisa que no se muestra en ninguna store', () => {
    expect(notaVisibilidad([])).toBe('No se muestra en ninguna store: el producto no aparece en el catálogo público.')
    expect(notaVisibilidad(['San Javucho'])).toBe('Visible en San Javucho.')
    expect(notaVisibilidad(['San Javucho', 'Mundo JC'])).toBe('Visible en San Javucho y Mundo JC.')
  })
})

describe('empresasCambiaron', () => {
  it('compara como conjunto, sin importar el orden', () => {
    expect(empresasCambiaron(['b', 'a'], ['a', 'b'])).toBe(false)
    expect(empresasCambiaron(['a'], ['a', 'b'])).toBe(true)
    expect(empresasCambiaron(['a', 'c'], ['a', 'b'])).toBe(true)
    expect(empresasCambiaron([], [])).toBe(false)
  })
})

describe('definirEmpresasProducto', () => {
  it('llama a la RPC con el producto y las empresas', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    await definirEmpresasProducto({ rpc } as never, 'p-1', ['e-1', 'e-2'])
    expect(rpc).toHaveBeenCalledWith('definir_empresas_producto', { p_producto_id: 'p-1', p_empresa_ids: ['e-1', 'e-2'] })
  })
  it('propaga el error del servidor', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '22023', message: 'ajena' } })
    await expect(definirEmpresasProducto({ rpc } as never, 'p-1', ['x'])).rejects.toMatchObject({ code: '22023' })
  })
})

describe('leerEmpresasProducto', () => {
  it('lee los ids de dominio.producto_empresa del producto', async () => {
    const returns = vi.fn().mockResolvedValue({ data: [{ empresa_id: 'e-1' }, { empresa_id: 'e-2' }], error: null })
    const eq = vi.fn(() => ({ returns }))
    const from = vi.fn(() => ({ select: () => ({ eq }) }))
    const schema = vi.fn(() => ({ from }))
    expect(await leerEmpresasProducto({ schema } as never, 'p-1')).toEqual(['e-1', 'e-2'])
    expect(schema).toHaveBeenCalledWith('dominio')
    expect(from).toHaveBeenCalledWith('producto_empresa')
    expect(eq).toHaveBeenCalledWith('producto_id', 'p-1')
  })
  it('propaga el error', async () => {
    const returns = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') })
    const cliente = { schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ returns }) }) }) }) }
    await expect(leerEmpresasProducto(cliente as never, 'p-1')).rejects.toThrow('boom')
  })
})
