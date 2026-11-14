import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { from: mocks.from } }))

import {
  ErrorConsulta,
  ETIQUETA_ORIGEN_CONSULTA,
  listarItemsConsulta,
  textoProductoConsulta,
  totalReferenciaPedido,
  esConflicto,
  formatearCuando,
  limitesDeFecha,
  mensajeDeError,
  nombreProducto,
  textoParaBusqueda,
} from './consultas'

describe('textoParaBusqueda (FR-004: filtro `or` de PostgREST, nunca sintaxis del cliente)', () => {
  it('trata comas, paréntesis, comillas, barras y comodines como separadores', () => {
    expect(textoParaBusqueda('  Ana, (Pérez)%_  ')).toBe('Ana Pérez')
    expect(textoParaBusqueda('"x"\\y*z')).toBe('x y z')
  })

  it('sin nada que buscar devuelve cadena vacía', () => {
    expect(textoParaBusqueda('%_,()')).toBe('')
    expect(textoParaBusqueda('   ')).toBe('')
  })
})

describe('limitesDeFecha (FR-006: rango por día local, «hasta» exclusivo)', () => {
  it('desde las 00:00 del primer día hasta las 00:00 del siguiente al último', () => {
    const { desde, hastaExclusivo } = limitesDeFecha('2026-10-01', '2026-10-03')
    expect(new Date(desde!).getTime()).toBe(new Date('2026-10-01T00:00:00').getTime())
    expect(new Date(hastaExclusivo!).getTime()).toBe(new Date('2026-10-04T00:00:00').getTime())
  })

  it('una fecha mal formada se ignora en vez de romper la consulta', () => {
    expect(limitesDeFecha('ayer', '2026-13-99')).toEqual({ desde: null, hastaExclusivo: null })
  })
})

describe('formatearCuando (columna «Cuándo»)', () => {
  const ahora = new Date(2026, 9, 23, 12, 0, 0)

  it('usa Hoy, Ayer y la fecha corta', () => {
    expect(formatearCuando(new Date(2026, 9, 23, 11, 48).toISOString(), ahora)).toBe('Hoy 11:48')
    expect(formatearCuando(new Date(2026, 9, 22, 19, 30).toISOString(), ahora)).toBe('Ayer 19:30')
    expect(formatearCuando(new Date(2026, 8, 26, 16, 40).toISOString(), ahora)).toBe('26/09 16:40')
    expect(formatearCuando(new Date(2025, 8, 26, 16, 40).toISOString(), ahora)).toBe('26/09/2025 16:40')
  })

  it('una fecha inválida no rompe la celda', () => {
    expect(formatearCuando('no-es-fecha', ahora)).toBe('—')
  })
})

describe('errores de las RPC (FR-003 y FR-007)', () => {
  it('40001 se reconoce como conflicto y muestra un mensaje claro', () => {
    const error = new ErrorConsulta('duplicate key', '40001')
    expect(esConflicto(error)).toBe(true)
    expect(mensajeDeError(error, 'otro')).toContain('Otra persona modificó')
  })

  it('42501 y 22023 no filtran el texto crudo de la base', () => {
    expect(mensajeDeError(new ErrorConsulta('permission denied for table', '42501'), 'x')).toContain('No tenés permiso')
    expect(mensajeDeError(new ErrorConsulta('invalid input syntax', '22023'), 'x')).toContain('Revisá los datos')
  })

  it('un error desconocido usa el mensaje por defecto y no es conflicto', () => {
    const desconocido = new Error('boom')
    expect(esConflicto(desconocido)).toBe(false)
    expect(mensajeDeError(desconocido, 'No pudimos guardar.')).toBe('No pudimos guardar.')
  })
})

describe('nombreProducto (FR-004: «Sin producto»)', () => {
  it('cae al texto del prototipo cuando la consulta no tiene producto', () => {
    expect(nombreProducto({ producto_nombre: null })).toBe('Sin producto')
    expect(nombreProducto({ producto_nombre: 'Funda' })).toBe('Funda')
  })
})

describe('pedidos de la tienda (MSF-176, B1, P-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.select.mockReturnValue({ eq: mocks.eq })
    mocks.eq.mockReturnValue({ order: mocks.order })
  })

  it('el origen pedido se rotula «Pedido»', () => {
    expect(ETIQUETA_ORIGEN_CONSULTA.pedido).toBe('Pedido')
  })

  it('columna Producto: «Pedido de n productos» («1 producto»); las demás consultas conservan su producto', () => {
    expect(textoProductoConsulta({ origen: 'pedido', producto_nombre: null, items_cantidad: 3 })).toBe('Pedido de 3 productos')
    expect(textoProductoConsulta({ origen: 'pedido', producto_nombre: null, items_cantidad: 1 })).toBe('Pedido de 1 producto')
    expect(textoProductoConsulta({ origen: 'pedido', producto_nombre: null })).toBe('Pedido de 0 productos')
    expect(textoProductoConsulta({ origen: 'formulario', producto_nombre: 'Funda', items_cantidad: 0 })).toBe('Funda')
    expect(textoProductoConsulta({ origen: 'whatsapp', producto_nombre: null })).toBe('Sin producto')
  })

  it('lee los ítems de la vista del panel, en orden, y acomoda los tipos (texto crudo, nada de HTML interpretado)', async () => {
    mocks.order.mockResolvedValue({
      data: [
        { orden: 1, producto_id: 'p-1', descripcion: '<script>alert(1)</script>', sku: 'S-1', cantidad: 2, precio_referencia: '2500.5' },
        { orden: 2, producto_id: null, descripcion: 'Cable', sku: '', cantidad: 1, precio_referencia: null },
      ],
      error: null,
    })
    const items = await listarItemsConsulta('c-1')
    expect(mocks.from).toHaveBeenCalledWith('consulta_items_bandeja')
    expect(mocks.eq).toHaveBeenCalledWith('consulta_id', 'c-1')
    expect(mocks.order).toHaveBeenCalledWith('orden', { ascending: true })
    expect(items).toEqual([
      { orden: 1, producto_id: 'p-1', descripcion: '<script>alert(1)</script>', sku: 'S-1', cantidad: 2, precio_referencia: 2500.5 },
      { orden: 2, producto_id: null, descripcion: 'Cable', sku: null, cantidad: 1, precio_referencia: null },
    ])
  })

  it('un error de la base se traduce a ErrorConsulta', async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } })
    await expect(listarItemsConsulta('c-1')).rejects.toBeInstanceOf(ErrorConsulta)
  })

  it('total de referencia: suma de precio × cantidad de las líneas con precio; null si ninguna lo tiene', () => {
    const item = (cantidad: number, precio: number | null) => ({ orden: 1, producto_id: null, descripcion: 'x', sku: null, cantidad, precio_referencia: precio })
    expect(totalReferenciaPedido([item(2, 2500), item(1, null), item(3, 100.5)])).toBe(5301.5)
    expect(totalReferenciaPedido([item(1, null)])).toBeNull()
    expect(totalReferenciaPedido([])).toBeNull()
  })
})
