import { describe, expect, it, vi } from 'vitest'
import { BUCKET_COPIAS, BUCKET_ORIGINALES, LADO_MAXIMO_COPIA_PX, MAX_BYTES_COPIA, prepararImagenesNewsletter, type DependenciasCopias } from './newsletterImagenes'

const ORG = '11111111-1111-1111-1111-111111111111'
const producto = (n: number) => ({ producto_id: `p-${n}`, organizacion_id: ORG, imagen_id: `i-${n}`, origen: `${ORG}/p-${n}/frente.png` })
const webp = (bytes: number) => new File([new Uint8Array(bytes)], 'x.webp', { type: 'image/webp' })

function montar(sobre: Partial<DependenciasCopias> & { lista?: unknown; errorLista?: unknown } = {}) {
  const rpc = vi.fn(async (nombre: string, _parametros: Record<string, unknown> = {}): Promise<{ data: unknown; error: unknown }> => {
    if (nombre === 'productos_para_imagenes_newsletter') return { data: 'lista' in sobre ? sobre.lista : [producto(1), producto(2)], error: sobre.errorLista ?? null }
    return { data: { ruta: 'x' }, error: null }
  })
  const descargar = vi.fn(async (_bucket: string, _ruta: string): Promise<Blob | null> => new Blob([new Uint8Array(50)], { type: 'image/png' }))
  const subir = vi.fn(async (_bucket: string, _ruta: string, _archivo: File) => true)
  const urlPublica = vi.fn((bucket: string, ruta: string) => `https://p.supabase.co/storage/v1/object/public/${bucket}/${ruta}`)
  const optimizar = vi.fn(async (_archivo: File, _lado: number) => webp(1000))
  const deps = { rpc, descargar, subir, urlPublica, optimizar, ...sobre } as Pick<DependenciasCopias, 'rpc'> & Partial<DependenciasCopias>
  delete (deps as Record<string, unknown>).lista
  delete (deps as Record<string, unknown>).errorLista
  return { deps, rpc, descargar, subir, urlPublica, optimizar }
}
const entrada = { empresa: 'e-1', destacados: true, promociones: false }

describe('prepararImagenesNewsletter', () => {
  it('copia cada producto: baja el original privado, optimiza a 600 px, sube a la ruta org/tienda/producto.webp y registra la dirección pública', async () => {
    const m = montar()
    const resultado = await prepararImagenesNewsletter(entrada, m.deps)
    expect(resultado).toEqual({ copiadas: 2, omitidas: 0 })
    expect(m.descargar.mock.calls).toEqual([[BUCKET_ORIGINALES, `${ORG}/p-1/frente.png`], [BUCKET_ORIGINALES, `${ORG}/p-2/frente.png`]])
    expect(m.optimizar.mock.calls.map((c) => c[1])).toEqual([600, 600])
    expect(LADO_MAXIMO_COPIA_PX).toBe(600)
    expect(m.subir.mock.calls.map((c) => [c[0], c[1]])).toEqual([[BUCKET_COPIAS, `${ORG}/e-1/p-1.webp`], [BUCKET_COPIAS, `${ORG}/e-1/p-2.webp`]])
    const registros = m.rpc.mock.calls.filter((c) => c[0] === 'registrar_imagen_newsletter')
    expect(registros[0][1]).toEqual({
      p_empresa: 'e-1', p_producto: 'p-1', p_imagen: 'i-1',
      p_url: `https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/${ORG}/e-1/p-1.webp`,
    })
    expect(registros).toHaveLength(2)
  })

  it('pide la lista a la base con la tienda y las secciones', async () => {
    const m = montar({ lista: [] })
    await prepararImagenesNewsletter({ empresa: 'e-9', destacados: true, promociones: true }, m.deps)
    expect(m.rpc).toHaveBeenCalledWith('productos_para_imagenes_newsletter', { p_empresa: 'e-9', p_destacados: true, p_promociones: true })
  })

  it('sin secciones no llama a nada', async () => {
    const m = montar()
    expect(await prepararImagenesNewsletter({ empresa: 'e-1', destacados: false, promociones: false }, m.deps)).toEqual({ copiadas: 0, omitidas: 0 })
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('tope de la copia: 262144 bytes entra y 262145 se omite (n / n+1); lo que no es WebP también', async () => {
    expect(MAX_BYTES_COPIA).toBe(262144)
    const casos: [File, number][] = [[webp(MAX_BYTES_COPIA - 1), 1], [webp(MAX_BYTES_COPIA), 1], [webp(MAX_BYTES_COPIA + 1), 0], [new File([new Uint8Array(10)], 'x.png', { type: 'image/png' }), 0]]
    for (const [archivo, copiadas] of casos) {
      const m = montar({ lista: [producto(1)], optimizar: async () => archivo })
      const r = await prepararImagenesNewsletter(entrada, m.deps)
      expect(r, `${archivo.type} ${archivo.size}`).toEqual({ copiadas, omitidas: 1 - copiadas })
      expect(m.subir).toHaveBeenCalledTimes(copiadas)
    }
  })

  it('un original que no se puede bajar se omite sin subir ni registrar, y los demás siguen', async () => {
    const m = montar()
    m.deps.descargar = vi.fn(async (_b: string, ruta: string) => (ruta.includes('p-1') ? null : new Blob([new Uint8Array(5)], { type: 'image/png' })))
    const r = await prepararImagenesNewsletter(entrada, m.deps)
    expect(r).toEqual({ copiadas: 1, omitidas: 1 })
    expect(m.subir).toHaveBeenCalledTimes(1)
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'registrar_imagen_newsletter')).toHaveLength(1)
  })

  it('si falla la subida no se registra nada', async () => {
    const m = montar({ lista: [producto(1)], subir: async () => false })
    expect(await prepararImagenesNewsletter(entrada, m.deps)).toEqual({ copiadas: 0, omitidas: 1 })
    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(['productos_para_imagenes_newsletter'])
  })

  it('si el registro responde un error el producto cuenta como omitido', async () => {
    const m = montar({ lista: [producto(1)] })
    m.rpc.mockImplementation(async (nombre: string) => (nombre === 'registrar_imagen_newsletter' ? { data: null, error: { code: '22023' } } : { data: [producto(1)], error: null }))
    expect(await prepararImagenesNewsletter(entrada, m.deps)).toEqual({ copiadas: 0, omitidas: 1 })
  })

  it('una excepción al bajar, optimizar o subir omite ese producto y no corta el envío', async () => {
    for (const falla of ['descargar', 'optimizar', 'subir'] as const) {
      const m = montar({ lista: [producto(1), producto(2)], [falla]: async () => { throw new Error('boom') } })
      const r = await prepararImagenesNewsletter(entrada, m.deps)
      expect(r, falla).toEqual({ copiadas: 0, omitidas: 2 })
    }
  })

  it('una lista con error, que no es arreglo o que lanza deja el resultado vacío sin lanzar', async () => {
    expect(await prepararImagenesNewsletter(entrada, montar({ errorLista: { code: '42501' } }).deps)).toEqual({ copiadas: 0, omitidas: 0 })
    expect(await prepararImagenesNewsletter(entrada, montar({ lista: { ok: true } }).deps)).toEqual({ copiadas: 0, omitidas: 0 })
    const m = montar()
    m.deps.rpc = async () => { throw new Error('red') }
    expect(await prepararImagenesNewsletter(entrada, m.deps)).toEqual({ copiadas: 0, omitidas: 0 })
  })

  it('un elemento mal formado de la lista se omite', async () => {
    const m = montar({ lista: [{ producto_id: 'p-1' }, null, 'x', producto(2)] })
    expect(await prepararImagenesNewsletter(entrada, m.deps)).toEqual({ copiadas: 1, omitidas: 3 })
  })
})
