import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import {
  enviarListaPedido,
  ErrorListaPedido,
  MENSAJE_CARACTERES,
  MENSAJES_PEDIDO,
  revalidarLista,
  traducirListaRevalidada,
  traducirRespuestaPedido,
  validarPedido,
} from './tiendaPedido'

const HOST = 'mundojc.localhost'
const ID = 'a1000000-0000-4000-8000-000000000001'
const LINEAS = [{ productoId: ID, cantidad: 3 }]
const CLAVE = 'b1000000-0000-4000-8000-000000000001'

const linea = (extra: Record<string, unknown> = {}) => ({
  producto_id: ID, nombre: 'Joystick', sku: 'JOY-1', imagen: 'org/prod/1.jpg', cantidad: 3, disponible: true,
  precio_unitario: 2500, precio_anterior: null, escala: 'x1', subtotal: 7500, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
})

describe('revalidarLista (FR-023)', () => {
  it('manda solo producto_id y cantidad (nunca precios) y acomoda la forma', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', con_cuenta: false, tipo: null, lineas: [linea()], no_disponibles: [], total_referencia: 7500 }, error: null })
    const lista = await revalidarLista(HOST, LINEAS)
    expect(mocks.schema).toHaveBeenCalledWith('publico')
    expect(mocks.rpc).toHaveBeenCalledWith('lista_pedido_por_dominio', { host: HOST, items: [{ producto_id: ID, cantidad: 3 }] })
    expect(lista).toEqual({
      conCuenta: false, tipo: null, noDisponibles: [], totalReferencia: 7500,
      lineas: [{ productoId: ID, nombre: 'Joystick', sku: 'JOY-1', imagen: 'org/prod/1.jpg', cantidad: 3, disponible: true, precioUnitario: 2500, precioAnterior: null, escala: 'x1', subtotal: 7500 }],
    })
  })

  it('un precio nulo es «precio a confirmar» (no 0); un importe que no es número es un error', () => {
    const sinPrecio = traducirListaRevalidada({ estado: 'ok', lineas: [linea({ precio_unitario: null, subtotal: null })], no_disponibles: [ID], total_referencia: null })
    expect(sinPrecio.lineas[0].precioUnitario).toBeNull()
    expect(sinPrecio.totalReferencia).toBeNull()
    expect(sinPrecio.noDisponibles).toEqual([ID])
    expect(() => traducirListaRevalidada({ estado: 'ok', lineas: [linea({ precio_unitario: 'caro' })], no_disponibles: [] })).toThrow(ErrorListaPedido)
  })

  it('con cuenta mayorista conserva el tipo y la escala; importes numéricos como texto se convierten', () => {
    const lista = traducirListaRevalidada({ estado: 'ok', con_cuenta: true, tipo: 'mayorista', lineas: [linea({ escala: 'x10', precio_unitario: '800.50' })], no_disponibles: [], total_referencia: '9606' })
    expect(lista.conCuenta).toBe(true)
    expect(lista.tipo).toBe('mayorista')
    expect(lista.lineas[0].escala).toBe('x10')
    expect(lista.lineas[0].precioUnitario).toBe(800.5)
  })

  it('traduce limite, invalido y cualquier forma inesperada a errores sin detalles técnicos', () => {
    expect(() => traducirListaRevalidada({ estado: 'limite', espera_segundos: 42 })).toThrow(expect.objectContaining({ codigo: 'limite', esperaSegundos: 42 }))
    expect(() => traducirListaRevalidada({ estado: 'invalido', campos: ['items'] })).toThrow(expect.objectContaining({ codigo: 'invalido' }))
    expect(() => traducirListaRevalidada({ estado: 'error' })).toThrow(expect.objectContaining({ codigo: 'error' }))
    expect(() => traducirListaRevalidada(null)).toThrow(ErrorListaPedido)
    expect(() => traducirListaRevalidada({ estado: 'ok', lineas: 'x', no_disponibles: [] })).toThrow(ErrorListaPedido)
    expect(() => traducirListaRevalidada({ estado: 'ok', lineas: [{ producto_id: 5 }], no_disponibles: [] })).toThrow(ErrorListaPedido)
  })

  it('un error de red o de la base es un error genérico', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection refused: secreto interno' } })
    await expect(revalidarLista(HOST, LINEAS)).rejects.toMatchObject({ codigo: 'error', message: 'No pudimos revisar tu lista' })
  })
})

describe('validarPedido (espejo de enviar_lista_pedido)', () => {
  const bien = { nombre: ' Ana Pérez ', contacto: 'ana@example.com', nota: '' }

  it('visitante: datos válidos sin errores', () => {
    expect(validarPedido(bien, false)).toEqual({})
    expect(validarPedido({ ...bien, contacto: '+54 9 11 5555-1234' }, false)).toEqual({})
  })

  it('visitante: nombre vacío, largo, con caracteres de control o con salto de línea', () => {
    expect(validarPedido({ ...bien, nombre: '   ' }, false).nombre).toBe('Ingresá tu nombre.')
    expect(validarPedido({ ...bien, nombre: 'x'.repeat(101) }, false).nombre).toMatch(/hasta 100/)
    expect(validarPedido({ ...bien, nombre: 'Ana\u0001' }, false).nombre).toBe(MENSAJE_CARACTERES)
    expect(validarPedido({ ...bien, nombre: 'Ana\nBcc: x@example.com' }, false).nombre).toBe(MENSAJE_CARACTERES)
    expect(validarPedido({ ...bien, nombre: 'Ana‮cod' }, false).nombre).toBe(MENSAJE_CARACTERES)
  })

  it('visitante: contacto que no es correo ni teléfono de 8 a 15 números', () => {
    for (const contacto of ['', 'no es un contacto', '1234567', '1'.repeat(16), 'a@b']) {
      expect(validarPedido({ ...bien, contacto }, false).contacto).toBe(MENSAJES_PEDIDO.contacto)
    }
  })

  it('nota: hasta 500, el salto de línea se acepta y los caracteres de control no', () => {
    expect(validarPedido({ ...bien, nota: 'x'.repeat(500) }, false)).toEqual({})
    expect(validarPedido({ ...bien, nota: 'x'.repeat(501) }, false).nota).toBe(MENSAJES_PEDIDO.nota)
    expect(validarPedido({ ...bien, nota: 'línea 1\nlínea 2' }, false)).toEqual({})
    expect(validarPedido({ ...bien, nota: 'línea 1\r\nlínea 2' }, false)).toEqual({})
    expect(validarPedido({ ...bien, nota: 'hola\u0007' }, false).nota).toBe(MENSAJE_CARACTERES)
  })

  it('con cuenta activa no se validan nombre ni contacto; la nota sí', () => {
    expect(validarPedido({ nombre: '', contacto: '', nota: '' }, true)).toEqual({})
    expect(validarPedido({ nombre: '', contacto: '', nota: 'x'.repeat(501) }, true)).toEqual({ nota: MENSAJES_PEDIDO.nota })
  })

  it('HTML, fórmulas y javascript: son texto válido (se guardan literales)', () => {
    expect(validarPedido({ nombre: '<script>alert(1)</script>', contacto: 'x@example.com', nota: '=HYPERLINK("http://malo.example")' }, false)).toEqual({})
  })
})

describe('enviarListaPedido (FR-027)', () => {
  it('llama a enviar_lista_pedido con los datos recortados, la lista sin precios y la clave', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok' }, error: null })
    const resultado = await enviarListaPedido(HOST, { nombre: ' Ana ', contacto: ' ana@example.com ', nota: '  Hola\r\nchau  ' }, LINEAS, CLAVE)
    expect(resultado).toEqual({ estado: 'exito' })
    expect(mocks.rpc).toHaveBeenCalledWith('enviar_lista_pedido', {
      host: HOST, nombre: 'Ana', contacto: 'ana@example.com', nota: 'Hola\nchau', items: [{ producto_id: ID, cantidad: 3 }], clave_envio: CLAVE,
    })
  })

  it('sin nota manda null', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok' }, error: null })
    await enviarListaPedido(HOST, { nombre: 'Ana', contacto: 'ana@example.com', nota: '   ' }, LINEAS, CLAVE)
    expect(mocks.rpc.mock.calls[0][1].nota).toBeNull()
  })

  it('traduce cada estado: invalido con campos, limite con espera, error y falla de red', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(traducirRespuestaPedido({ estado: 'invalido', campos: ['contacto', 'raro', 'items'], no_disponibles: [ID, 5] })).toEqual({ estado: 'invalido', campos: ['contacto', 'items'], noDisponibles: [ID] })
    expect(traducirRespuestaPedido({ estado: 'limite', espera_segundos: 125 })).toEqual({ estado: 'espera', esperaSegundos: 125 })
    expect(traducirRespuestaPedido({ estado: 'error' })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPedido(null)).toEqual({ estado: 'falla' })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'detalle interno' } })
    expect(await enviarListaPedido(HOST, { nombre: 'Ana', contacto: 'ana@example.com', nota: '' }, LINEAS, CLAVE)).toEqual({ estado: 'falla' })
    mocks.rpc.mockRejectedValue(new Error('sin red'))
    expect(await enviarListaPedido(HOST, { nombre: 'Ana', contacto: 'ana@example.com', nota: '' }, LINEAS, CLAVE)).toEqual({ estado: 'falla' })
  })
})
