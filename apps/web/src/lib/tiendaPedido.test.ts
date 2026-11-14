import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import {
  cotizarPresupuesto,
  crearPresupuesto,
  enviarListaPedido,
  ErrorListaPedido,
  MENSAJE_CARACTERES,
  MENSAJES_PEDIDO,
  revalidarLista,
  traducirCotizacion,
  traducirListaRevalidada,
  traducirRespuestaPedido,
  traducirRespuestaPresupuesto,
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

  it('M-4: los caracteres invisibles (U+061C, U+200B a U+200D, U+2060, U+FEFF) se rechazan en nombre, contacto y nota, igual que en el servidor', () => {
    for (const invisible of ['\u00ad', '\u061c', '\u180e', '\u200b', '\u200c', '\u200d', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\ufeff']) {
      expect(validarPedido({ ...bien, nota: `hola${invisible}chau` }, false).nota).toBe(MENSAJE_CARACTERES)
      expect(validarPedido({ ...bien, nombre: `Ana${invisible}Pérez` }, false).nombre).toBe(MENSAJE_CARACTERES)
    }
    expect(validarPedido({ ...bien, nota: 'hola\u200e' }, false).nota).toBe(MENSAJE_CARACTERES)
  })

  it('M-4: una nota solo de espacios y saltos de línea es «sin nota» (válida)', () => {
    expect(validarPedido({ ...bien, nota: ' \n\r\n \t ' }, false)).toEqual({})
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

// ---------------------------------------------------------------------------------------------------------------------------------
// MSF-176 · B2 · Presupuesto desde la tienda (FR-050 a FR-059)
// ---------------------------------------------------------------------------------------------------------------------------------
const lineaCot = (extra: Record<string, unknown> = {}) => ({
  producto_id: ID, descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precio_unitario: 2000, subtotal_sin_iva: 6000, iva: 1260, disponible: true, ...extra,
})
const cotOk = (extra: Record<string, unknown> = {}) => ({
  estado: 'ok', lineas: [lineaCot()], total_sin_iva: 6000, iva: 1260, total_con_iva: 7260, no_disponibles: [], sin_precio: [], ...extra,
})

describe('cotizarPresupuesto (FR-050)', () => {
  it('manda solo host y la lista {producto_id, cantidad}: nunca precio, escala, descuento, cliente ni empresa', async () => {
    mocks.rpc.mockResolvedValue({ data: cotOk(), error: null })
    const resultado = await cotizarPresupuesto(HOST, LINEAS)
    expect(mocks.schema).toHaveBeenCalledWith('publico')
    expect(mocks.rpc).toHaveBeenCalledWith('cotizar_presupuesto_tienda', { host: HOST, items: [{ producto_id: ID, cantidad: 3 }] })
    expect(resultado).toEqual({
      estado: 'ok',
      cotizacion: {
        lineas: [{ productoId: ID, descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precioUnitario: 2000, subtotalSinIva: 6000, iva: 1260, disponible: true }],
        totalSinIva: 6000, iva: 1260, totalConIva: 7260, noDisponibles: [], sinPrecio: [],
      },
    })
  })

  it('acepta importes como texto numérico y conserva los productos no disponibles y sin precio', async () => {
    mocks.rpc.mockResolvedValue({ data: cotOk({ total_con_iva: '7260.50', no_disponibles: [ID, 5], sin_precio: ['x'] }), error: null })
    const resultado = await cotizarPresupuesto(HOST, LINEAS)
    expect(resultado.estado === 'ok' && resultado.cotizacion.totalConIva).toBe(7260.5)
    expect(resultado.estado === 'ok' && resultado.cotizacion.noDisponibles).toEqual([ID])
    expect(resultado.estado === 'ok' && resultado.cotizacion.sinPrecio).toEqual(['x'])
  })

  it('un importe faltante o no numérico NO se vuelve 0: es una falla reintentable', () => {
    expect(traducirCotizacion(cotOk({ total_con_iva: null }))).toEqual({ estado: 'falla' })
    expect(traducirCotizacion(cotOk({ lineas: [lineaCot({ precio_unitario: 'abc' })] }))).toEqual({ estado: 'falla' })
    expect(traducirCotizacion(cotOk({ lineas: [lineaCot({ cantidad: 0 })] }))).toEqual({ estado: 'falla' })
    expect(traducirCotizacion(cotOk({ lineas: 'no es lista' }))).toEqual({ estado: 'falla' })
    expect(traducirCotizacion(null)).toEqual({ estado: 'falla' })
  })

  it('traduce cada estado de la base y los fallos de red', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(traducirCotizacion({ estado: 'invalido', campos: ['items'] })).toEqual({ estado: 'invalido' })
    expect(traducirCotizacion({ estado: 'limite', espera_segundos: 61 })).toEqual({ estado: 'espera', esperaSegundos: 61 })
    expect(traducirCotizacion({ estado: 'limite' })).toEqual({ estado: 'espera', esperaSegundos: 60 })
    expect(traducirCotizacion({ estado: 'sin_acceso' })).toEqual({ estado: 'sin_acceso' })
    expect(traducirCotizacion({ estado: 'error' })).toEqual({ estado: 'falla' })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'detalle interno de Postgres' } })
    expect(await cotizarPresupuesto(HOST, LINEAS)).toEqual({ estado: 'falla' })
    mocks.rpc.mockRejectedValue(new Error('sin red'))
    expect(await cotizarPresupuesto(HOST, LINEAS)).toEqual({ estado: 'falla' })
  })
})

describe('crearPresupuesto (FR-051, FR-052, FR-058, FR-059)', () => {
  it('manda host, la lista sin precios, la nota recortada (o null) y la clave de envío', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok', numero: '00000012', fecha: '2026-11-14', total_con_iva: 7260 }, error: null })
    const resultado = await crearPresupuesto(HOST, LINEAS, '  Después de las 18\r\nhs  ', CLAVE)
    expect(mocks.rpc).toHaveBeenCalledWith('crear_presupuesto_tienda', {
      host: HOST, items: [{ producto_id: ID, cantidad: 3 }], nota: 'Después de las 18\nhs', clave_envio: CLAVE,
    })
    expect(resultado).toEqual({ estado: 'exito', numero: '00000012', fecha: '2026-11-14', totalConIva: 7260 })
    await crearPresupuesto(HOST, LINEAS, '   ', CLAVE)
    expect(mocks.rpc.mock.calls[1][1].nota).toBeNull()
  })

  it('traduce cada estado del contrato', () => {
    expect(traducirRespuestaPresupuesto({ estado: 'invalido', campos: ['nota', 'raro', 'items'] })).toEqual({ estado: 'invalido', campos: ['nota', 'items'] })
    expect(traducirRespuestaPresupuesto({ estado: 'sin_precio', producto_id: ID })).toEqual({ estado: 'sin_precio', productoId: ID })
    expect(traducirRespuestaPresupuesto({ estado: 'no_disponible', producto_id: ID })).toEqual({ estado: 'no_disponible', productoId: ID })
    expect(traducirRespuestaPresupuesto({ estado: 'no_disponible' })).toEqual({ estado: 'no_disponible', productoId: null })
    expect(traducirRespuestaPresupuesto({ estado: 'limite', espera_segundos: 125 })).toEqual({ estado: 'espera', esperaSegundos: 125 })
    expect(traducirRespuestaPresupuesto({ estado: 'limite_cuenta' })).toEqual({ estado: 'limite_cuenta' })
    expect(traducirRespuestaPresupuesto({ estado: 'sin_acceso' })).toEqual({ estado: 'sin_acceso' })
    expect(traducirRespuestaPresupuesto({ estado: 'error' })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPresupuesto({ estado: 'algo-nuevo' })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPresupuesto(null)).toEqual({ estado: 'falla' })
  })

  it('un ok sin número o sin total numérico no se afirma: es una falla', () => {
    expect(traducirRespuestaPresupuesto({ estado: 'ok', total_con_iva: 100 })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPresupuesto({ estado: 'ok', numero: '', total_con_iva: 100 })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPresupuesto({ estado: 'ok', numero: '00000001', total_con_iva: 'mucho' })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaPresupuesto({ estado: 'ok', numero: '00000001', total_con_iva: '50.25' })).toEqual({ estado: 'exito', numero: '00000001', fecha: '', totalConIva: 50.25 })
  })

  it('un corte de red o un error del servidor no muestran el detalle técnico: falla', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'detalle interno' } })
    expect(await crearPresupuesto(HOST, LINEAS, '', CLAVE)).toEqual({ estado: 'falla' })
    mocks.rpc.mockRejectedValue(new Error('sin red'))
    expect(await crearPresupuesto(HOST, LINEAS, '', CLAVE)).toEqual({ estado: 'falla' })
  })
})
