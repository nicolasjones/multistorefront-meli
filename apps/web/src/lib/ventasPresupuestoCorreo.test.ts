import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  solicitarDocumento: vi.fn(),
  esperarDocumento: vi.fn(),
  urlFirmadaDocumento: vi.fn(),
  registrarImpresion: vi.fn(),
}))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./ventasImpresion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ventasImpresion')>()),
  solicitarDocumento: mocks.solicitarDocumento,
  esperarDocumento: mocks.esperarDocumento,
  urlFirmadaDocumento: mocks.urlFirmadaDocumento,
}))
vi.mock('./ventasImpresiones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ventasImpresiones')>()),
  registrarImpresion: mocks.registrarImpresion,
}))

import {
  MENSAJE_ENVIO_TARDA,
  enviarPresupuestoCorreo,
  enviarYEsperar,
  listarEnviosCorreo,
  mensajeDeErrorEnvio,
  mensajeEnviadoAImprimir,
  mensajeEnviadoPorCorreo,
  prepararImpresionPresupuesto,
  textoMarcaEnvio,
  ultimoEnvioEnviado,
  type EnvioCorreoPresupuesto,
} from './ventasPresupuestoCorreo'

const envio = (cambios: Partial<EnvioCorreoPresupuesto> = {}): EnvioCorreoPresupuesto => ({
  id: 'v-1', comprobante_id: 'k-1', empresa_id: 'e-1', documento_id: 'd-1', destinatario: 'a@b.test',
  estado: 'pendiente', error: null, solicitado_en: '2026-10-25T10:00:00Z', enviado_en: null, ...cambios,
})
const sinEspera = () => Promise.resolve()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('llamadas a la base', () => {
  it('enviarPresupuestoCorreo llama a la RPC con el comprobante', async () => {
    mocks.rpc.mockResolvedValue({ data: envio(), error: null })
    await expect(enviarPresupuestoCorreo('k-1')).resolves.toMatchObject({ id: 'v-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('enviar_presupuesto_correo', { p_comprobante_id: 'k-1' })
  })

  it('listarEnviosCorreo llama a la RPC y devuelve la lista (vacía si la base no devuelve filas)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [envio()], error: null }).mockResolvedValueOnce({ data: null, error: null })
    await expect(listarEnviosCorreo('k-1')).resolves.toHaveLength(1)
    expect(mocks.rpc).toHaveBeenCalledWith('listar_envios_correo_presupuesto', { p_comprobante_id: 'k-1' })
    await expect(listarEnviosCorreo('k-1')).resolves.toEqual([])
  })

  it('propaga el error de la base', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(enviarPresupuestoCorreo('k-1')).rejects.toEqual({ code: '42501' })
  })
})

describe('enviarYEsperar (FR-025)', () => {
  it('devuelve el envío cuando ya salió', async () => {
    mocks.rpc.mockResolvedValue({ data: envio({ estado: 'enviado', enviado_en: '2026-10-25T10:01:00Z' }), error: null })
    await expect(enviarYEsperar('k-1', { esperar: sinEspera })).resolves.toMatchObject({ estado: 'enviado' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('consulta hasta que el envío sale', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: envio(), error: null })
      .mockResolvedValueOnce({ data: [envio()], error: null })
      .mockResolvedValueOnce({ data: [envio({ estado: 'enviado', enviado_en: '2026-10-25T10:01:00Z' })], error: null })
    await expect(enviarYEsperar('k-1', { esperar: sinEspera })).resolves.toMatchObject({ estado: 'enviado' })
    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual([
      'enviar_presupuesto_correo', 'listar_envios_correo_presupuesto', 'listar_envios_correo_presupuesto',
    ])
  })

  it('un envío fallido lanza con el motivo sanitizado de la base', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: envio(), error: null })
      .mockResolvedValueOnce({ data: [envio({ estado: 'fallido', error: 'No se pudo enviar el correo' })], error: null })
    await expect(enviarYEsperar('k-1', { esperar: sinEspera })).rejects.toThrow('No se pudo enviar el correo')
  })

  it('pasado el tope avisa que tarda más de lo esperado', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => ({ data: nombre === 'enviar_presupuesto_correo' ? envio() : [envio()], error: null }))
    await expect(enviarYEsperar('k-1', { esperar: sinEspera, intervaloMs: 1000, topeMs: 3000 })).rejects.toThrow(MENSAJE_ENVIO_TARDA)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })

  it('cancelado deja de consultar', async () => {
    mocks.rpc.mockResolvedValue({ data: envio(), error: null })
    const control = new AbortController()
    control.abort()
    await expect(enviarYEsperar('k-1', { signal: control.signal, esperar: sinEspera })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('prepararImpresionPresupuesto (FR-022)', () => {
  it('pide el presupuesto, espera, firma la URL y recién ahí registra la impresión', async () => {
    mocks.solicitarDocumento.mockResolvedValue({ id: 'd-1', estado: 'pendiente', ruta: null })
    mocks.esperarDocumento.mockResolvedValue({ id: 'd-1', estado: 'generado', ruta: 'o/e/k/d-1.pdf' })
    mocks.urlFirmadaDocumento.mockResolvedValue('https://storage/p.pdf')
    mocks.registrarImpresion.mockResolvedValue({})
    const orden: string[] = []
    mocks.urlFirmadaDocumento.mockImplementation(async () => { orden.push('url'); return 'https://storage/p.pdf' })
    mocks.registrarImpresion.mockImplementation(async () => { orden.push('registro') })

    await expect(prepararImpresionPresupuesto('k-1')).resolves.toMatchObject({ url: 'https://storage/p.pdf' })
    expect(mocks.solicitarDocumento).toHaveBeenCalledWith('k-1', 'presupuesto')
    expect(orden).toEqual(['url', 'registro'])
    expect(mocks.registrarImpresion).toHaveBeenCalledWith('d-1')
  })

  it('reutiliza el PDF ya generado sin esperar', async () => {
    mocks.solicitarDocumento.mockResolvedValue({ id: 'd-1', estado: 'generado', ruta: 'o/e/k/d-1.pdf' })
    mocks.urlFirmadaDocumento.mockResolvedValue('https://storage/p.pdf')
    mocks.registrarImpresion.mockResolvedValue({})
    await prepararImpresionPresupuesto('k-1')
    expect(mocks.esperarDocumento).not.toHaveBeenCalled()
  })

  it('si el documento falla no registra ninguna impresión (F-VTA-21, FR-034)', async () => {
    mocks.solicitarDocumento.mockResolvedValue({ id: 'd-1', estado: 'pendiente', ruta: null })
    mocks.esperarDocumento.mockRejectedValue(new Error('falló'))
    await expect(prepararImpresionPresupuesto('k-1')).rejects.toThrow('falló')
    expect(mocks.registrarImpresion).not.toHaveBeenCalled()
  })
})

describe('textos', () => {
  it('arma los mensajes de confirmación del prototipo', () => {
    expect(mensajeEnviadoAImprimir('00000007')).toBe('Enviado a imprimir · 00000007')
    expect(mensajeEnviadoPorCorreo('00000007')).toBe('Presupuesto 00000007 enviado por correo')
  })

  it('la marca lleva fecha y hora de Buenos Aires, o queda sin ellas si nunca se envió', () => {
    expect(textoMarcaEnvio(envio({ estado: 'enviado', enviado_en: '2026-10-07T14:42:00Z' }))).toBe('Presupuesto enviado por correo · 07/10 11:42')
    expect(textoMarcaEnvio(undefined)).toBe('Presupuesto enviado por correo')
    expect(textoMarcaEnvio(envio({ enviado_en: 'no es una fecha' }))).toBe('Presupuesto enviado por correo')
  })

  it('el último envío enviado ignora los pendientes y fallidos', () => {
    const lista = [envio({ id: 'a', estado: 'fallido' }), envio({ id: 'b', estado: 'enviado', enviado_en: '2026-10-07T14:42:00Z' }), envio({ id: 'c', estado: 'enviado' })]
    expect(ultimoEnvioEnviado(lista)?.id).toBe('b')
    expect(ultimoEnvioEnviado([envio({ estado: 'pendiente' })])).toBeUndefined()
  })

  it('traduce los errores de la base a mensajes claros', () => {
    expect(mensajeDeErrorEnvio({ code: '42501' })).toMatch(/No tenés permiso para enviar presupuestos/)
    expect(mensajeDeErrorEnvio({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeErrorEnvio({ code: '22023', message: 'El cliente no tiene un correo válido cargado.' })).toBe('El cliente no tiene un correo válido cargado.')
    expect(mensajeDeErrorEnvio({ code: 'P0001', hint: 'sin_conexion', message: 'Todavía no está habilitado.' })).toBe('Todavía no está habilitado.')
    expect(mensajeDeErrorEnvio({ code: 'XX000', message: 'detalle técnico' })).toBe('No pudimos enviar el presupuesto por correo. Probá de nuevo.')
  })
})
