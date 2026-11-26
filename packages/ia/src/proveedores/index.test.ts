import { describe, expect, it, vi } from 'vitest'
import type { PerfilModelo } from '../types.js'
import type { FetchInvocacion } from './index.js'
import { descubrirModelos, invocarProveedorIa } from './index.js'

function perfil(proveedorCodigo: string, modeloId: string): PerfilModelo {
  return { id: 'perfil-fixture', proveedorCodigo, modeloId }
}

function respuesta(json: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => json }
}

describe('invocarProveedorIa', () => {
  it('anthropic: POST a /messages con x-api-key y anthropic-version', async () => {
    const fetchInvocacion: FetchInvocacion = vi.fn().mockResolvedValue(respuesta({ texto: 'ok' }))
    await invocarProveedorIa(perfil('anthropic', 'claude-fixture'), 'clave-fixture', { mensaje: 'hola' }, fetchInvocacion)

    expect(fetchInvocacion).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'clave-fixture', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: 'hola' }),
    })
  })

  it('gemini: el modelo va en la URL, header x-goog-api-key', async () => {
    const fetchInvocacion: FetchInvocacion = vi.fn().mockResolvedValue(respuesta({ texto: 'ok' }))
    await invocarProveedorIa(perfil('google', 'gemini-fixture'), 'clave-fixture', { contents: [] }, fetchInvocacion)

    expect(fetchInvocacion).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent',
      { method: 'POST', headers: { 'x-goog-api-key': 'clave-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [] }) },
    )
  })

  it('openai: Authorization Bearer', async () => {
    const fetchInvocacion: FetchInvocacion = vi.fn().mockResolvedValue(respuesta({ texto: 'ok' }))
    await invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', { mensajes: [] }, fetchInvocacion)

    expect(fetchInvocacion).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer clave-fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensajes: [] }),
    })
  })

  it('respuesta no exitosa lanza INVOCACION_PROVEEDOR_IA_FALLO_<status>', async () => {
    const fetchInvocacion: FetchInvocacion = vi.fn().mockResolvedValue(respuesta({ error: 'mal' }, false, 429))

    await expect(invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, fetchInvocacion))
      .rejects.toThrow('INVOCACION_PROVEEDOR_IA_FALLO_429')
  })

  it('respuesta exitosa devuelve el json crudo sin transformar', async () => {
    const crudo = { forma: 'lo-que-sea-que-devuelva-el-proveedor' }
    const fetchInvocacion: FetchInvocacion = vi.fn().mockResolvedValue(respuesta(crudo))

    await expect(invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, fetchInvocacion))
      .resolves.toEqual(crudo)
  })

  it('proveedor sin endpoint de invocación soportado (baidu) propaga el error del catálogo', async () => {
    const fetchInvocacion: FetchInvocacion = vi.fn()

    await expect(invocarProveedorIa(perfil('baidu-ernie', 'ernie-fixture'), 'clave-fixture', {}, fetchInvocacion))
      .rejects.toThrow('PROVEEDOR_IA_SIN_ENDPOINT_INVOCACION')
    expect(fetchInvocacion).not.toHaveBeenCalled()
  })
  it('sin timeoutMs el fetch no recibe signal (comportamiento anterior)', async () => {
    const fetchInvocacion = vi.fn().mockResolvedValue(respuesta({}))
    await invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, fetchInvocacion)
    expect(fetchInvocacion.mock.calls[0][1]).not.toHaveProperty('signal')
  })

  it('un timeoutMs no positivo o inválido no agrega signal (0 abortaría al instante)', async () => {
    for (const timeoutMs of [0, -5, Number.NaN]) {
      const fetchInvocacion = vi.fn().mockResolvedValue(respuesta({}))
      await invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, fetchInvocacion, { timeoutMs })
      expect(fetchInvocacion.mock.calls[0][1]).not.toHaveProperty('signal')
    }
  })

  it('con timeoutMs el fetch recibe un AbortSignal', async () => {
    const fetchInvocacion = vi.fn().mockResolvedValue(respuesta({}))
    await invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, fetchInvocacion, { timeoutMs: 5000 })
    expect(fetchInvocacion.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('un proveedor colgado falla con INVOCACION_PROVEEDOR_IA_TIMEOUT al vencer el tiempo, sin detalle del proveedor', async () => {
    const colgado: FetchInvocacion = (_url, init) => new Promise((_ok, rechazar) => {
      init.signal?.addEventListener('abort', () => rechazar(init.signal?.reason), { once: true })
    })
    await expect(invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, colgado, { timeoutMs: 20 }))
      .rejects.toThrow('INVOCACION_PROVEEDOR_IA_TIMEOUT')
  })

  it('el tiempo agotado leyendo el cuerpo también es un timeout; otros errores se propagan', async () => {
    const lento: FetchInvocacion = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('x', 'TimeoutError') } })
    await expect(invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, lento)).rejects.toThrow('INVOCACION_PROVEEDOR_IA_TIMEOUT')
    const roto: FetchInvocacion = vi.fn().mockRejectedValue(new Error('red caída'))
    await expect(invocarProveedorIa(perfil('openai', 'gpt-fixture'), 'clave-fixture', {}, roto)).rejects.toThrow('red caída')
  })
})

describe('descubrirModelos con timeout', () => {
  it('con timeoutMs lleva signal y un proveedor colgado falla con DESCUBRIMIENTO_MODELOS_IA_TIMEOUT', async () => {
    const colgado = (_url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => new Promise<never>((_ok, rechazar) => {
      init.signal?.addEventListener('abort', () => rechazar(init.signal?.reason), { once: true })
    })
    await expect(descubrirModelos('openai', 'clave-fixture', colgado, { timeoutMs: 20 })).rejects.toThrow('DESCUBRIMIENTO_MODELOS_IA_TIMEOUT')
  })

  it('sin timeoutMs no hay signal y la respuesta no exitosa conserva su error', async () => {
    const fetchModelos = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(descubrirModelos('openai', 'clave-fixture', fetchModelos)).rejects.toThrow('DESCUBRIMIENTO_MODELOS_IA_FALLO_500')
    expect(fetchModelos.mock.calls[0][1]).not.toHaveProperty('signal')
  })
})
