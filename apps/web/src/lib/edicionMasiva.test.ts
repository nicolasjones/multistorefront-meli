import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  avisoResultado,
  cambiarEstadoProductos,
  definirEmpresasProductos,
  mensajeErrorEdicionMasiva,
  moverProductosCategoria,
  productosN,
} from './edicionMasiva'

const cliente = (respuesta: { data?: unknown; error?: unknown }) => ({ rpc: vi.fn().mockResolvedValue({ data: null, error: null, ...respuesta }) })

afterEach(() => vi.restoreAllMocks())

describe('edicionMasiva (F-CAT-12)', () => {
  it('llama a cada RPC con sus argumentos y devuelve la cantidad que cambió', async () => {
    const c = cliente({ data: 3 })
    expect(await moverProductosCategoria(c as never, ['a', 'b'], 'cat')).toBe(3)
    expect(c.rpc).toHaveBeenLastCalledWith('mover_productos_categoria', { p_producto_ids: ['a', 'b'], p_categoria_id: 'cat' })
    expect(await cambiarEstadoProductos(c as never, ['a'], false)).toBe(3)
    expect(c.rpc).toHaveBeenLastCalledWith('cambiar_estado_productos', { p_producto_ids: ['a'], p_activo: false })
    expect(await definirEmpresasProductos(c as never, ['a'], ['e1'], ['e2'])).toBe(3)
    expect(c.rpc).toHaveBeenLastCalledWith('definir_empresas_productos', { p_producto_ids: ['a'], p_agregar: ['e1'], p_quitar: ['e2'] })
  })

  it('una lista vacía se manda tal cual y el error de la base se propaga (la base rechaza con 22023)', async () => {
    const error = { code: '22023', message: 'Elegí al menos un producto' }
    const c = cliente({ error })
    await expect(moverProductosCategoria(c as never, [], 'cat')).rejects.toBe(error)
    expect(c.rpc).toHaveBeenCalledWith('mover_productos_categoria', { p_producto_ids: [], p_categoria_id: 'cat' })
  })

  it('un resultado nulo cuenta como 0', async () => {
    expect(await cambiarEstadoProductos(cliente({ data: null }) as never, ['a'], true)).toBe(0)
  })

  it('avisoResultado: «No hubo cambios» con 0, singular, plural y destino', () => {
    expect(avisoResultado(0, { singular: 'movido', plural: 'movidos' })).toBe('No hubo cambios')
    expect(avisoResultado(1, { singular: 'movido', plural: 'movidos' }, 'Joysticks')).toBe('1 producto movido a Joysticks')
    expect(avisoResultado(2, { singular: 'activado', plural: 'activados' })).toBe('2 productos activados')
    expect(productosN(1)).toBe('1 producto')
  })

  it('traduce cada código de la base a un mensaje claro y nunca muestra el detalle técnico', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mensajeErrorEdicionMasiva({ code: '42501', message: 'x' })).toMatch(/No tenés permiso/)
    expect(mensajeErrorEdicionMasiva({ code: 'P0002', message: 'x' })).toMatch(/ya no existe/)
    expect(mensajeErrorEdicionMasiva({ code: '22023', message: 'x' })).toMatch(/no es válido/)
    const otro = mensajeErrorEdicionMasiva(new Error('boom interno'))
    expect(otro).toMatch(/No se cambió ningún producto/)
    expect(otro).not.toMatch(/boom/)
    expect(mensajeErrorEdicionMasiva(null)).toMatch(/No pudimos aplicar el cambio/)
  })
})
