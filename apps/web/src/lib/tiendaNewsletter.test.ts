import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import {
  confirmarNewsletter,
  leerNewsletterTienda,
  suscribirseNewsletter,
  traducirRespuestaSuscripcion,
  validarSuscripcion,
} from './tiendaNewsletter'

const TOKEN = 'ab'.repeat(32)

describe('validarSuscripcion (espejo de la base)', () => {
  it('exige correo válido y la casilla marcada', () => {
    expect(validarSuscripcion({ correo: '', consentimiento: false })).toEqual({ correo: 'Escribí tu correo.', consentimiento: 'Marcá la casilla para suscribirte.' })
    expect(validarSuscripcion({ correo: 'ana@ejemplo.com', consentimiento: true })).toEqual({})
  })

  it('rechaza más de una dirección, formato inválido y más de 254 caracteres', () => {
    expect(validarSuscripcion({ correo: 'a@x.com,b@x.com', consentimiento: true }).correo).toBeDefined()
    expect(validarSuscripcion({ correo: 'a@x.com;b@x.com', consentimiento: true }).correo).toBeDefined()
    expect(validarSuscripcion({ correo: 'sin-arroba', consentimiento: true }).correo).toBeDefined()
    expect(validarSuscripcion({ correo: `${'a'.repeat(250)}@x.com`, consentimiento: true }).correo).toBeDefined()
  })

  it('rechaza <, >, comillas, paréntesis, backslash y dos puntos (una dirección real por fila)', () => {
    for (const correo of ['a<victima@dom.com>', 'b<victima@dom.com>', 'a"b@dom.com', 'a(b)@dom.com', 'a\\b@dom.com', 'a:b@dom.com', '{{envs.x}}@dom.com', 'a{b}@dom.com', 'a b@dom.com', 'a@b', 'a@b..co']) {
      expect(validarSuscripcion({ correo, consentimiento: true }).correo, correo).toBeDefined()
    }
    for (const correo of ['a.b+c@sub.dom-x.com', "o'brien@ejemplo.com.ar"]) {
      expect(validarSuscripcion({ correo, consentimiento: true }), correo).toEqual({})
    }
  })

  it('rechaza puntos dobles, iniciales o finales, IP, etiquetas rotas, % ! | / y un local de más de 64', () => {
    for (const correo of ['a..b@x.com', '.a@x.com', 'a.@x.com', 'a@1.2.3.4', 'a@-.-', 'a%b@x.com', 'a!b@x.com', 'a|b@x.com', 'a/b@x.com', 'a@x.c', 'a@-x.com', 'a@x-.com', 'a@x..com', 'ñandú@x.com', 'user@bücher.de', 'a@b.xn--p1ai', `${'a'.repeat(65)}@x.com`]) {
      expect(validarSuscripcion({ correo, consentimiento: true }).correo, correo).toBeDefined()
    }
    for (const correo of ['a.b+c@sub.dom-x.com', "o'brien@x.com", 'x@xn--ejemplo-9ua.com', 'a@xn--bcher-kva.de', `${'a'.repeat(64)}@x.com`]) {
      expect(validarSuscripcion({ correo, consentimiento: true }), correo).toEqual({})
    }
  })

  it('recorta y no distingue mayúsculas', () => {
    expect(validarSuscripcion({ correo: '  Ana@Ejemplo.COM ', consentimiento: true })).toEqual({})
  })
})

describe('traducirRespuestaSuscripcion', () => {
  it('traduce ok, invalido, limite y cualquier otra cosa como falla', () => {
    expect(traducirRespuestaSuscripcion({ resultado: 'ok' })).toEqual({ estado: 'exito' })
    expect(traducirRespuestaSuscripcion({ resultado: 'invalido', campos: ['consentimiento', 'correo'] })).toEqual({ estado: 'invalido', campos: ['correo', 'consentimiento'] })
    expect(traducirRespuestaSuscripcion({ resultado: 'limite', espera_segundos: 125 })).toEqual({ estado: 'espera', esperaSegundos: 125 })
    expect(traducirRespuestaSuscripcion({ resultado: 'error' })).toEqual({ estado: 'falla' })
    expect(traducirRespuestaSuscripcion(null)).toEqual({ estado: 'falla' })
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => vi.clearAllMocks())

  it('leerNewsletterTienda: solo activo con el nombre de la tienda', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { activo: true, tienda: 'Mundo JC' }, error: null })
    expect(await leerNewsletterTienda('h')).toEqual({ activo: true, tienda: 'Mundo JC' })
    expect(mocks.rpc).toHaveBeenCalledWith('newsletter_por_dominio', { p_host: 'h' })
    mocks.rpc.mockResolvedValueOnce({ data: { activo: false }, error: null })
    expect(await leerNewsletterTienda('h')).toEqual({ activo: false, tienda: null })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await leerNewsletterTienda('h')).toEqual({ activo: false, tienda: null })
  })

  it('suscribirseNewsletter envía el correo recortado, la casilla, la clave y la trampa; el error de red es falla sin detalle', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { resultado: 'ok' }, error: null })
    expect(await suscribirseNewsletter('h', { correo: ' ana@ejemplo.com ', consentimiento: true }, 'clave-1', '')).toEqual({ estado: 'exito' })
    expect(mocks.rpc).toHaveBeenCalledWith('suscribirse_newsletter', { p_host: 'h', p_correo: 'ana@ejemplo.com', p_consentimiento: true, p_clave: 'clave-1', p_trampa: '' })
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockRejectedValueOnce(new Error('corte de red con ana@ejemplo.com'))
    expect(await suscribirseNewsletter('h', { correo: 'ana@ejemplo.com', consentimiento: true }, 'clave-2', '')).toEqual({ estado: 'falla' })
    consola.mockRestore()
  })

  it('confirmarNewsletter: un token mal formado ni se envía; traduce ok, vencido, invalido y limite', async () => {
    expect(await confirmarNewsletter('h', 'no-es-un-token')).toBe('invalido')
    expect(mocks.rpc).not.toHaveBeenCalled()
    for (const [resultado, esperado] of [['ok', 'ok'], ['vencido', 'vencido'], ['invalido', 'invalido'], ['limite', 'espera']] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: { resultado }, error: null })
      expect(await confirmarNewsletter('h', TOKEN)).toBe(esperado)
    }
    expect(mocks.rpc).toHaveBeenLastCalledWith('confirmar_newsletter', { p_host: 'h', p_token: TOKEN })
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    expect(await confirmarNewsletter('h', TOKEN)).toBe('falla')
    consola.mockRestore()
  })
})
