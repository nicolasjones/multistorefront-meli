import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import {
  cambiarFavorito,
  ErrorCuentaTienda,
  esSinAcceso,
  formatearFechaCuenta,
  formatearImporteArs,
  formatearNumeroComprobante,
  leerFavoritosEntre,
  leerMiCompra,
  leerMisCompras,
  leerMisFavoritos,
} from './tiendaCuentaDatos'

const HOST = 'mundojc.localhost'
const ID = 'a1000000-0000-4000-8000-000000000001'
const ID_2 = 'a1000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
})

describe('leerMisCompras', () => {
  it('pide la primera tanda de 20 con el host y sin cursor, y acomoda la forma', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        estado: 'ok',
        total: 2,
        filas: [
          { id: ID, numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', total_con_iva: '85000.50' },
          { id: ID_2, numero: 'B-3', fecha: '2026-11-10', tipo: 'nota_credito', estado_publico: 'nota_credito', total_con_iva: -1210 },
        ],
        siguiente: { fecha: '2026-11-10', id: ID_2 },
      },
      error: null,
    })
    const pagina = await leerMisCompras(HOST)
    expect(mocks.schema).toHaveBeenCalledWith('publico')
    expect(mocks.rpc).toHaveBeenCalledWith('mis_compras_por_dominio', { host: HOST, desde_fecha: null, desde_id: null, limite: 20 })
    expect(pagina.total).toBe(2)
    expect(pagina.filas[0]).toEqual({ id: ID, numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado: 'pendiente', totalConIva: 85000.5 })
    expect(pagina.filas[1].totalConIva).toBe(-1210)
    expect(pagina.siguiente).toEqual({ fecha: '2026-11-10', id: ID_2 })
  })

  it('con cursor lo manda tal cual y acota el límite a 1–50', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', total: 0, filas: [], siguiente: null }, error: null })
    await leerMisCompras(HOST, { fecha: '2026-11-10', id: ID_2 }, 500)
    expect(mocks.rpc).toHaveBeenCalledWith('mis_compras_por_dominio', { host: HOST, desde_fecha: '2026-11-10', desde_id: ID_2, limite: 50 })
    await leerMisCompras(HOST, null, 0)
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_compras_por_dominio', expect.objectContaining({ limite: 1 }))
  })

  it('un estado público desconocido nunca llega como texto interno', async () => {
    mocks.rpc.mockResolvedValue({
      data: { estado: 'ok', total: 1, filas: [{ id: ID, numero: '1', fecha: '2026-11-12', tipo: 'compra', estado_publico: 'cobrado', total_con_iva: 1 }], siguiente: null },
      error: null,
    })
    const { filas } = await leerMisCompras(HOST)
    expect(filas[0].estado).toBe('confirmada')
  })

  it('sin_acceso se vuelve un error propio que la interfaz trata como «cuenta no activa»', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'sin_acceso' }, error: null })
    const error = await leerMisCompras(HOST).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorCuentaTienda)
    expect(esSinAcceso(error)).toBe(true)
    expect((error as Error).message).toBe('Tu cuenta no está activa en esta tienda')
  })

  it('un error de red o de la base es un error genérico en castellano, sin texto de Postgres', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation "x" does not exist' } })
    const error = await leerMisCompras(HOST).catch((e: unknown) => e)
    expect(esSinAcceso(error)).toBe(false)
    expect((error as Error).message).toBe('No pudimos completar la operación. Probá de nuevo.')
    expect((error as Error).message).not.toMatch(/relation/)
  })

  it('el estado `error` del servidor también es un error genérico', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'error' }, error: null })
    await expect(leerMisCompras(HOST)).rejects.toBeInstanceOf(ErrorCuentaTienda)
  })
})

describe('leerMiCompra', () => {
  const DETALLE = {
    estado: 'ok', numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', valido_hasta: null,
    total_sin_iva: '100', iva: '21', total_con_iva: '121',
    lineas: [{ descripcion: 'Cable USB', codigo: 'CAB-1', cantidad: 2, precio_unitario: '50', subtotal: '100' }],
  }

  it('devuelve solo la lista blanca: aunque la respuesta traiga costos o descuentos, no llegan', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...DETALLE, costo: 10, margen: 0.4, descuento_pct: 15, operador: 'Ana', deposito: 'Central', notas: 'interno', cliente_id: 'x', lineas: [{ ...DETALLE.lineas[0], costo_unitario: 5, descuento_pct: 15 }] },
      error: null,
    })
    const detalle = await leerMiCompra(HOST, ID)
    expect(mocks.rpc).toHaveBeenCalledWith('mi_compra_por_dominio', { host: HOST, comprobante_id: ID })
    expect(detalle).toEqual({
      numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado: 'pendiente', validoHasta: null,
      totalSinIva: 100, iva: 21, totalConIva: 121,
      lineas: [{ descripcion: 'Cable USB', codigo: 'CAB-1', cantidad: 2, precioUnitario: 50, subtotal: 100 }],
    })
    const claves = JSON.stringify(detalle)
    for (const prohibida of ['costo', 'margen', 'descuento', 'operador', 'deposito', 'notas', 'cliente_id']) expect(claves).not.toContain(prohibida)
  })

  it('un comprobante ajeno o inexistente (no_encontrada) es null, igual para los dos casos', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'no_encontrada' }, error: null })
    await expect(leerMiCompra(HOST, ID)).resolves.toBeNull()
  })

  it('un id que no es uuid ni se pide a la base', async () => {
    await expect(leerMiCompra(HOST, 'no-es-uuid')).resolves.toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin_acceso lanza el error propio', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'sin_acceso' }, error: null })
    await expect(leerMiCompra(HOST, ID)).rejects.toSatisfy(esSinAcceso)
  })
})

describe('leerMisFavoritos', () => {
  it('acomoda la fila y el cursor (acepta `creado_en` o `creado`)', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        estado: 'ok', total: 1,
        filas: [{ producto_id: ID, nombre: 'Joystick', sku: 'JOY-1', imagen: 'org/a.png', disponible: true, precio_final: '2500', escala: 'x10' }],
        siguiente: { creado_en: '2026-11-12T10:00:00Z', id: ID },
      },
      error: null,
    })
    const pagina = await leerMisFavoritos(HOST)
    expect(mocks.rpc).toHaveBeenCalledWith('mis_favoritos_por_dominio', { host: HOST, desde_creado: null, desde_id: null, limite: 20 })
    expect(pagina.filas[0]).toEqual({ productoId: ID, nombre: 'Joystick', sku: 'JOY-1', imagen: 'org/a.png', disponible: true, precioFinal: 2500, escala: 'x10' })
    expect(pagina.siguiente).toEqual({ creado: '2026-11-12T10:00:00Z', id: ID })
    await leerMisFavoritos(HOST, pagina.siguiente)
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_favoritos_por_dominio', { host: HOST, desde_creado: '2026-11-12T10:00:00Z', desde_id: ID, limite: 20 })
  })

  it('sin precio: precioFinal es null (la pantalla dice «Precio a confirmar»)', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', total: 1, filas: [{ producto_id: ID, nombre: 'X', disponible: false, precio_final: null, escala: 'x1' }], siguiente: null }, error: null })
    const { filas, siguiente } = await leerMisFavoritos(HOST)
    expect(filas[0].precioFinal).toBeNull()
    expect(siguiente).toBeNull()
  })
})

describe('cambiarFavorito', () => {
  it('guarda y quita con el host y el producto (nunca cuenta ni cliente)', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', favorito: true }, error: null })
    await expect(cambiarFavorito(HOST, ID, true)).resolves.toEqual({ estado: 'ok', favorito: true })
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_favorito_por_dominio', { host: HOST, producto_id: ID, favorito: true })
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', favorito: false }, error: null })
    await expect(cambiarFavorito(HOST, ID, false)).resolves.toEqual({ estado: 'ok', favorito: false })
  })

  it('el 201 devuelve limite_favoritos y un producto oculto, no_encontrado', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'limite_favoritos' }, error: null })
    await expect(cambiarFavorito(HOST, ID, true)).resolves.toEqual({ estado: 'limite_favoritos' })
    mocks.rpc.mockResolvedValue({ data: { estado: 'no_encontrado' }, error: null })
    await expect(cambiarFavorito(HOST, ID, true)).resolves.toEqual({ estado: 'no_encontrado' })
  })

  it('sin_acceso lanza y error también', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'sin_acceso' }, error: null })
    await expect(cambiarFavorito(HOST, ID, true)).rejects.toSatisfy(esSinAcceso)
    mocks.rpc.mockResolvedValue({ data: { estado: 'error' }, error: null })
    await expect(cambiarFavorito(HOST, ID, true)).rejects.toBeInstanceOf(ErrorCuentaTienda)
  })
})

describe('leerFavoritosEntre', () => {
  it('una sola llamada con los ids únicos (tope 50) y devuelve la intersección', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', favoritos: [ID] }, error: null })
    await expect(leerFavoritosEntre(HOST, [ID, ID, ID_2, 'no-uuid'])).resolves.toEqual([ID])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('favoritos_entre_por_dominio', { host: HOST, productos: [ID, ID_2] })
  })

  it('sin ids válidos no llama', async () => {
    await expect(leerFavoritosEntre(HOST, [])).resolves.toEqual([])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('formatos', () => {
  it('importes con centavos y signo', () => {
    expect(formatearImporteArs(12500)).toBe('$ 12.500,00')
    expect(formatearImporteArs(85000.5)).toBe('$ 85.000,50')
    expect(formatearImporteArs(0)).toBe('$ 0,00')
    expect(formatearImporteArs(-1210)).toBe('-$ 1.210,00')
    expect(formatearImporteArs(1234567.891)).toBe('$ 1.234.567,89')
  })
  it('fecha dd/mm/aaaa sin correr de día y número con ceros', () => {
    expect(formatearFechaCuenta('2026-11-12')).toBe('12/11/2026')
    expect(formatearFechaCuenta('2026-01-01T00:00:00Z')).toBe('01/01/2026')
    expect(formatearNumeroComprobante('12')).toBe('Nº 00000012')
    expect(formatearNumeroComprobante('00000012')).toBe('Nº 00000012')
    expect(formatearNumeroComprobante('B-0001')).toBe('Nº B-0001')
  })
})
