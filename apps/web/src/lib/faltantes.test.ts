import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { from: mocks.from, rpc: mocks.rpc } }))

import { avisarFaltantes, listarFaltantes, mensajeResultadoAviso, MAXIMO_AVISO, type Faltante } from './faltantes'

// Cliente falso con la cadena de PostgREST: cada método devuelve la misma cadena y se anotan las llamadas.
function clienteFalso(respuesta: { data: unknown; error: unknown; count: number | null }) {
  const llamadas: Array<[string, ...unknown[]]> = []
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'order', 'range']) {
    cadena[metodo] = vi.fn((...args: unknown[]) => { llamadas.push([metodo, ...args]); return cadena })
  }
  cadena.returns = vi.fn(() => { llamadas.push(['returns']); return Promise.resolve(respuesta) })
  mocks.from.mockImplementation((vista: string) => { llamadas.push(['from', vista]); return cadena })
  return { llamadas, cadena }
}

const fila = (extra: Partial<Faltante> = {}): Faltante => ({
  linea_id: 'l-1',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente_id: 'c-1',
  cliente: 'Cliente Uno',
  producto: 'Consola bajo pedido',
  sku: 'CON-1',
  pedido: 2,
  comprobante_id: 'f-1',
  comprobante_numero: 'A-0001',
  desde: '2026-10-05',
  estado_stock: 'disponible',
  aviso: 'sin_avisar',
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listarFaltantes (FR-302, FR-303: vista con tienda, paginación y orden)', () => {
  it('consulta la vista con el total exacto y la pagina de 25 en 25', async () => {
    const { llamadas } = clienteFalso({ data: [fila()], error: null, count: 1 })
    const resultado = await listarFaltantes({ empresaId: null, pagina: 1 })

    expect(llamadas[0]).toEqual(['from', 'faltantes_listado'])
    expect(llamadas).toContainEqual(['select', expect.stringContaining('linea_id'), { count: 'exact' }])
    expect(llamadas).toContainEqual(['order', 'desde', { ascending: false }])
    expect(llamadas).toContainEqual(['order', 'linea_id', { ascending: true }])
    expect(llamadas).toContainEqual(['range', 0, 24])
    expect(resultado).toEqual({ filas: [fila()], total: 1 })
  })

  it('con una tienda elegida acota por empresa; sin ella no filtra', async () => {
    const conTienda = clienteFalso({ data: [], error: null, count: 0 })
    await listarFaltantes({ empresaId: 'e-2', pagina: 2, tamano: 25 })
    expect(conTienda.llamadas).toContainEqual(['eq', 'empresa_id', 'e-2'])
    expect(conTienda.llamadas).toContainEqual(['range', 25, 49])

    const sinTienda = clienteFalso({ data: [], error: null, count: 0 })
    await listarFaltantes({ empresaId: null, pagina: 1 })
    expect(sinTienda.llamadas.some(([metodo]) => metodo === 'eq')).toBe(false)
  })

  it('devuelve el total informado por la base y una lista vacía si no hay filas', async () => {
    clienteFalso({ data: null, error: null, count: 0 })
    expect(await listarFaltantes({ empresaId: null, pagina: 1 })).toEqual({ filas: [], total: 0 })
  })

  it('si la base falla, propaga el error (la pantalla muestra el estado de error)', async () => {
    clienteFalso({ data: null, error: { message: 'boom' }, count: null })
    await expect(listarFaltantes({ empresaId: null, pagina: 1 })).rejects.toThrow('boom')
  })
})

describe('avisarFaltantes (FR-307: la RPC encola los avisos)', () => {
  it('llama a avisar_faltantes con las líneas elegidas y devuelve los conteos', async () => {
    const resultado = {
      encolados: 1, lineas_avisadas: 2, omitidos_ya_avisados: 0, omitidos_sin_stock: 1,
      omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
    }
    mocks.rpc.mockResolvedValue({ data: resultado, error: null })

    expect(await avisarFaltantes(['l-1', 'l-2'])).toEqual(resultado)
    expect(mocks.rpc).toHaveBeenCalledWith('avisar_faltantes', { p_lineas: ['l-1', 'l-2'] })
  })

  it('no llama a la base sin líneas o con más de 200', async () => {
    await expect(avisarFaltantes([])).rejects.toThrow('Elegí entre 1 y 200 faltantes para avisar.')
    await expect(avisarFaltantes(Array.from({ length: MAXIMO_AVISO + 1 }, (_, i) => `l-${i}`)))
      .rejects.toThrow('Elegí entre 1 y 200 faltantes para avisar.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un permiso insuficiente dice que no puede avisar; otro fallo, que pruebe de nuevo', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'sin permiso' } })
    await expect(avisarFaltantes(['l-1'])).rejects.toThrow('Tu rol no puede avisar faltantes.')

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'boom' } })
    await expect(avisarFaltantes(['l-1'])).rejects.toThrow('No pudimos enviar los avisos. Probá de nuevo.')
  })
})

describe('mensajeResultadoAviso (FR-306: el aviso emergente)', () => {
  const base = {
    encolados: 1, lineas_avisadas: 1, omitidos_ya_avisados: 0, omitidos_sin_stock: 0,
    omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
  }

  it('sin omitidos dice solo «Avisos enviados»', () => {
    expect(mensajeResultadoAviso(base)).toBe('Avisos enviados')
  })

  it('con omitidos informa cuántos y por qué', () => {
    expect(mensajeResultadoAviso({ ...base, omitidos_sin_stock: 1, omitidos_sin_correo: 2 }))
      .toBe('Avisos enviados. Se omitieron: 1 sin stock, 2 sin correo.')
    expect(mensajeResultadoAviso({ ...base, omitidos_ya_avisados: 3, omitidos_sin_permiso: 1 }))
      .toBe('Avisos enviados. Se omitieron: 3 ya avisados, 1 sin permiso.')
  })
})
