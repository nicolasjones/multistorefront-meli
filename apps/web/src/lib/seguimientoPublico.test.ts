import { describe, expect, it, vi } from 'vitest'
import { consultarEstadoReparacion as consultarReal } from './seguimientoPublico'

describe('consultarEstadoReparacion (FR-041)', () => {
  const respuesta = (status: number, cuerpo: unknown = {}, headers: Record<string, string> = {}) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(cuerpo), { status, headers }))

  it('llama sin sesión, con la clave pública y sin referrer, y mapea 200', async () => {
    const recurso = respuesta(200, { codigo: 'R-0001', cliente: 'Ana' })
    const r = await consultarReal('T'.repeat(32), recurso)
    expect(r.tipo).toBe('ok')
    expect(r.tipo === 'ok' && 'cliente' in r.estado).toBe(false)
    const [url, opciones] = recurso.mock.calls[0]
    expect(String(url)).toMatch(/\/functions\/v1\/consultar-estado-reparacion$/)
    expect(opciones).toMatchObject({ method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer' })
    expect(JSON.parse(opciones.body)).toEqual({ token: 'T'.repeat(32) })
  })

  it('mapea 404, 429 (con Retry-After), 500 y caída de red sin lanzar', async () => {
    expect(await consultarReal('t', respuesta(404))).toEqual({ tipo: 'no_encontrada' })
    expect(await consultarReal('t', respuesta(429, {}, { 'Retry-After': '90' }))).toEqual({ tipo: 'demasiadas', reintentarEn: 90 })
    expect(await consultarReal('t', respuesta(500))).toEqual({ tipo: 'error' })
    expect(await consultarReal('t', vi.fn().mockRejectedValue(new Error('red')))).toEqual({ tipo: 'error' })
  })
})
