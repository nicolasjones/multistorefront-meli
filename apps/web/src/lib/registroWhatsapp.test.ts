import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpcPublico: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: nombre === 'publico' ? mocks.rpcPublico : vi.fn() }) },
}))

import { nuevaClaveEnvioWhatsapp, registrarConsultaWhatsapp } from './registroWhatsapp'

const HOST = 'mundojc.localhost'
const PRODUCTO = '11111111-1111-4111-8111-111111111111'
const CLAVE = '00000000-0000-4000-8000-0000000000a1'

// F-TDA-14 (FR-024): el registro del interés por WhatsApp nunca bloquea la apertura ni muestra
// fallas o límite al visitante.
describe('registrarConsultaWhatsapp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a publico.registrar_consulta_whatsapp con el host, el producto y la clave de la apertura', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { estado: 'ok' }, error: null })
    expect(await registrarConsultaWhatsapp(HOST, PRODUCTO, CLAVE)).toBe('ok')
    expect(mocks.rpcPublico).toHaveBeenCalledWith('registrar_consulta_whatsapp', {
      host: HOST,
      producto: PRODUCTO,
      clave_envio: CLAVE,
    })
  })

  it('el límite vuelve como estado (el visitante no lo ve) y no lanza', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { estado: 'limite' }, error: null })
    expect(await registrarConsultaWhatsapp(HOST, PRODUCTO, CLAVE)).toBe('limite')
  })

  it('un error del servidor o un corte de red vuelven como `error`, sin detalle técnico para el visitante', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpcPublico.mockResolvedValueOnce({ data: null, error: { message: 'detalle interno' } })
    expect(await registrarConsultaWhatsapp(HOST, PRODUCTO, CLAVE)).toBe('error')
    mocks.rpcPublico.mockRejectedValueOnce(new Error('sin red'))
    expect(await registrarConsultaWhatsapp(HOST, PRODUCTO, CLAVE)).toBe('error')
    mocks.rpcPublico.mockResolvedValueOnce({ data: { estado: 'inventado' }, error: null })
    expect(await registrarConsultaWhatsapp(HOST, PRODUCTO, CLAVE)).toBe('error')
    consola.mockRestore()
  })

  it('un producto que no es un identificador válido ni se envía', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await registrarConsultaWhatsapp(HOST, 'no-es-un-id', CLAVE)).toBe('error')
    expect(mocks.rpcPublico).not.toHaveBeenCalled()
    consola.mockRestore()
  })
})

describe('nuevaClaveEnvioWhatsapp', () => {
  it('cada apertura tiene su propia clave (idempotencia)', () => {
    expect(nuevaClaveEnvioWhatsapp()).not.toBe(nuevaClaveEnvioWhatsapp())
    expect(nuevaClaveEnvioWhatsapp()).toMatch(/^[0-9a-f-]{36}$/)
  })

  // Contexto no seguro (la tienda abierta por http sin TLS): `crypto.randomUUID` no existe. La clave
  // se arma igual (uuid v4 con `getRandomValues`) para que el diálogo no se caiga ni repita clave.
  it('sin crypto.randomUUID igual devuelve un uuid válido y distinto en cada llamada', () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) })
    try {
      const primera = nuevaClaveEnvioWhatsapp()
      const segunda = nuevaClaveEnvioWhatsapp()
      expect(primera).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(segunda).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(segunda).not.toBe(primera)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sin Web Crypto tampoco lanza: devuelve un uuid válido y distinto en cada llamada', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      const primera = nuevaClaveEnvioWhatsapp()
      const segunda = nuevaClaveEnvioWhatsapp()
      expect(primera).toMatch(/^[0-9a-f-]{36}$/)
      expect(segunda).toMatch(/^[0-9a-f-]{36}$/)
      expect(segunda).not.toBe(primera)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
