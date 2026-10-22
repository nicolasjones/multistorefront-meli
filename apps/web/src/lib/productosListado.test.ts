import { describe, expect, it, vi } from 'vitest'
import { CONSULTA_INICIAL, consultarProductos, filtroBusquedaProductos, hayFiltrosActivos, LARGO_MAXIMO_BUSQUEDA } from './productosListado'

function clienteFalso(respuesta: { data: unknown; error: unknown; count: number | null }) {
  const llamadas: Array<[string, ...unknown[]]> = []
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'or', 'contains', 'order', 'range']) {
    cadena[metodo] = vi.fn((...args: unknown[]) => { llamadas.push([metodo, ...args]); return cadena })
  }
  cadena.returns = vi.fn(() => Promise.resolve(respuesta))
  const from = vi.fn((vista: string) => { llamadas.push(['from', vista]); return cadena })
  return { cliente: { from } as never, llamadas }
}

describe('filtroBusquedaProductos', () => {
  it('busca por nombre o SKU', () => {
    expect(filtroBusquedaProductos('joy')).toBe('nombre.ilike.%joy%,sku.ilike.%joy%')
  })
  it('escapa los comodines % y _ para buscarlos como texto', () => {
    expect(filtroBusquedaProductos('100%_x')).toBe('nombre.ilike.%100\\%\\_x%,sku.ilike.%100\\%\\_x%')
  })
  it('quita los caracteres que alterarían el filtro', () => {
    expect(filtroBusquedaProductos('a,b(c)"d\\e')).toBe('nombre.ilike.%a b c  d e%,sku.ilike.%a b c  d e%')
  })
  it('quita el comodín * de PostgREST', () => {
    expect(filtroBusquedaProductos('a*b')).toBe('nombre.ilike.%a b%,sku.ilike.%a b%')
  })
  it('acota el largo y devuelve null si queda vacío', () => {
    expect(filtroBusquedaProductos('x'.repeat(500))).toBe(`nombre.ilike.%${'x'.repeat(LARGO_MAXIMO_BUSQUEDA)}%,sku.ilike.%${'x'.repeat(LARGO_MAXIMO_BUSQUEDA)}%`)
    expect(filtroBusquedaProductos('   ')).toBeNull()
    expect(filtroBusquedaProductos('(,)')).toBeNull()
  })
})

describe('consultarProductos', () => {
  const respuesta = { data: [{ id: 'p-1', nombre: 'Joystick', sku: null, activo: true, imagen_ruta: null, empresa_ids: [] }], error: null, count: 60 }

  it('pide la primera página ordenada por nombre con desempate por id, sin filtros', async () => {
    const { cliente, llamadas } = clienteFalso(respuesta)
    const resultado = await consultarProductos(cliente, CONSULTA_INICIAL)
    expect(resultado).toEqual({ filas: respuesta.data, total: 60 })
    expect(llamadas[0]).toEqual(['from', 'v_productos_listado'])
    expect(llamadas).toContainEqual(['select', 'id, nombre, sku, activo, imagen_ruta, empresa_ids, categoria_id, categoria_ruta', { count: 'exact' }])
    expect(llamadas).toContainEqual(['order', 'nombre', { ascending: true, nullsFirst: false }])
    expect(llamadas).toContainEqual(['order', 'id', { ascending: true }])
    expect(llamadas).toContainEqual(['range', 0, 24])
    expect(llamadas.some(([m]) => m === 'eq' || m === 'or' || m === 'contains')).toBe(false)
  })

  it('aplica inactivos, búsqueda, orden descendente por estado y la página pedida', async () => {
    const { cliente, llamadas } = clienteFalso(respuesta)
    await consultarProductos(cliente, { texto: 'cab', estado: 'inactivos', columnaOrden: 'activo', direccion: 'desc', pagina: 3, empresaId: null, categoriaId: null })
    expect(llamadas).toContainEqual(['eq', 'activo', false])
    expect(llamadas).toContainEqual(['or', 'nombre.ilike.%cab%,sku.ilike.%cab%'])
    expect(llamadas).toContainEqual(['order', 'activo', { ascending: false, nullsFirst: true }])
    expect(llamadas).toContainEqual(['range', 50, 74])
  })

  it('filtra por tienda en el servidor con empresa_ids contiene la empresa', async () => {
    const { cliente, llamadas } = clienteFalso(respuesta)
    await consultarProductos(cliente, { ...CONSULTA_INICIAL, empresaId: 'emp-1' })
    expect(llamadas).toContainEqual(['contains', 'empresa_ids', ['emp-1']])
  })

  it('filtra por categoría en el servidor (una raíz incluye sus subcategorías)', async () => {
    const { cliente, llamadas } = clienteFalso(respuesta)
    await consultarProductos(cliente, { ...CONSULTA_INICIAL, categoriaId: 'cat-1' })
    expect(llamadas).toContainEqual(['contains', 'categoria_ids', ['cat-1']])
  })

  it('propaga el error del servidor', async () => {
    const { cliente } = clienteFalso({ data: null, error: new Error('boom'), count: null })
    await expect(consultarProductos(cliente, CONSULTA_INICIAL)).rejects.toThrow('boom')
  })
})

describe('hayFiltrosActivos', () => {
  it('detecta texto o estado distinto de Todos', () => {
    expect(hayFiltrosActivos(CONSULTA_INICIAL)).toBe(false)
    expect(hayFiltrosActivos({ ...CONSULTA_INICIAL, texto: 'a' })).toBe(true)
    expect(hayFiltrosActivos({ ...CONSULTA_INICIAL, estado: 'inactivos' })).toBe(true)
    expect(hayFiltrosActivos({ ...CONSULTA_INICIAL, empresaId: 'emp-1' })).toBe(true)
    expect(hayFiltrosActivos({ ...CONSULTA_INICIAL, categoriaId: 'cat-1' })).toBe(true)
  })
})
