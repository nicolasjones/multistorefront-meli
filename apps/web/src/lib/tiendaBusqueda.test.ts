import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { MAXIMO_CARACTERES_BUSQUEDA, TOPE_SUGERENCIAS, leerSugerencias, normalizarConsulta, urlResultados } from './tiendaBusqueda'

describe('normalizarConsulta', () => {
  it('colapsa espacios, recorta y acota el largo', () => {
    expect(normalizarConsulta('  cable   usb \n c ')).toBe('cable usb c')
    expect(normalizarConsulta('a'.repeat(MAXIMO_CARACTERES_BUSQUEDA + 20))).toHaveLength(MAXIMO_CARACTERES_BUSQUEDA)
    expect(normalizarConsulta(null)).toBe('')
    expect(normalizarConsulta(undefined)).toBe('')
  })
})

describe('urlResultados', () => {
  it('codifica el texto como parámetro de consulta', () => {
    expect(urlResultados('cable usb&x')).toBe('/catalogo?q=cable+usb%26x')
  })
})

describe('leerSugerencias', () => {
  beforeEach(() => mocks.rpc.mockReset())
  const producto = (i: number, extra: Record<string, unknown> = {}) => ({ id: `p${i}`, nombre: `Prod ${i}`, precio: '10.5', disponible: true, imagen: null, categoria_id: null, ...extra })

  it('sin respuesta de la base devuelve una búsqueda sin coincidencias', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(leerSugerencias('t.test', 'ca')).resolves.toEqual({ esperaSegundos: null, sugerencias: [] })
    expect(mocks.rpc).toHaveBeenCalledWith('sugerencias_busqueda_por_dominio', { host: 't.test', q: 'ca' })
  })

  it('convierte precios y pone null al precio anterior ausente', async () => {
    mocks.rpc.mockResolvedValue({ data: { limitado: false, espera_segundos: null, productos: [producto(1, { precio_anterior: '12' }), producto(2, { precio: null })] }, error: null })
    const { sugerencias, esperaSegundos } = await leerSugerencias('t.test', 'ca')
    expect(esperaSegundos).toBeNull()
    expect(sugerencias[0]).toMatchObject({ precio: 10.5, precioAnterior: 12 })
    expect(sugerencias[1]).toMatchObject({ precio: null, precioAnterior: null })
  })

  it('aplica el tope de sugerencias aunque la base mande más', async () => {
    const productos = Array.from({ length: TOPE_SUGERENCIAS + 3 }, (_, i) => producto(i))
    mocks.rpc.mockResolvedValue({ data: { limitado: false, espera_segundos: null, productos }, error: null })
    expect((await leerSugerencias('t.test', 'ca')).sugerencias).toHaveLength(TOPE_SUGERENCIAS)
  })

  it('con límite activo espera al menos un segundo', async () => {
    mocks.rpc.mockResolvedValue({ data: { limitado: true, espera_segundos: 0, productos: [] }, error: null })
    await expect(leerSugerencias('t.test', 'ca')).resolves.toMatchObject({ esperaSegundos: 1 })
    mocks.rpc.mockResolvedValue({ data: { limitado: true, espera_segundos: 7, productos: [] }, error: null })
    await expect(leerSugerencias('t.test', 'ca')).resolves.toMatchObject({ esperaSegundos: 7 })
  })

  it('propaga el error de la base como Error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(leerSugerencias('t.test', 'ca')).rejects.toThrow('boom')
  })
})
