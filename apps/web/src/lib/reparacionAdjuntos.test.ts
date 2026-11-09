import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, list: mocks.list }) },
  },
}))

import { EDAD_MINIMA_HUERFANO_MS, limpiarHuerfanos, quitarAdjunto, subirAdjunto } from './reparacionAdjuntos'

const ORG = '11111111-1111-4111-8111-111111111111'
const REP = '22222222-2222-4222-8222-222222222222'
const archivo = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' })
const hace = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('adjuntos de reparación: objetos sin fila (huérfanos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.upload.mockResolvedValue({ error: null })
    mocks.remove.mockResolvedValue({ error: null })
    mocks.list.mockResolvedValue({ data: [], error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('quitar reintenta el borrado del objeto antes de rendirse', async () => {
    mocks.rpc.mockResolvedValue({ data: { ruta: `${ORG}/${REP}/a.png` }, error: null })
    mocks.remove
      .mockResolvedValueOnce({ error: new Error('red') })
      .mockResolvedValueOnce({ error: new Error('red') })
      .mockResolvedValueOnce({ error: null })
    const promesa = quitarAdjunto('adj-1')
    await vi.runAllTimersAsync()
    await promesa
    expect(mocks.remove).toHaveBeenCalledTimes(3)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('quitar avisa en consola si ni con reintentos se pudo borrar, pero no lanza (la fila ya no existe)', async () => {
    mocks.rpc.mockResolvedValue({ data: { ruta: `${ORG}/${REP}/a.png` }, error: null })
    mocks.remove.mockResolvedValue({ error: new Error('red') })
    const promesa = quitarAdjunto('adj-1')
    await vi.runAllTimersAsync()
    await expect(promesa).resolves.toBeUndefined()
    expect(mocks.remove).toHaveBeenCalledTimes(3)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('limpiarHuerfanos borra solo lo que no tiene fila y tiene más de 10 minutos', async () => {
    mocks.list.mockResolvedValue({
      data: [
        { name: 'registrado.png', created_at: hace(EDAD_MINIMA_HUERFANO_MS * 3) },
        { name: 'huerfano-viejo.png', created_at: hace(EDAD_MINIMA_HUERFANO_MS * 2) },
        { name: 'subida-en-curso.png', created_at: hace(30 * 1000) },
        { name: 'sin-fecha.png', created_at: null },
      ],
      error: null,
    })
    mocks.rpc.mockResolvedValue({ data: [{ id: 'a', ruta: `${ORG}/${REP}/registrado.png` }], error: null })
    await expect(limpiarHuerfanos(ORG, REP)).resolves.toBe(1)
    expect(mocks.list).toHaveBeenCalledWith(`${ORG}/${REP}`, { limit: 100 })
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.remove).toHaveBeenCalledWith([`${ORG}/${REP}/huerfano-viejo.png`])
  })

  it('limpiarHuerfanos no hace nada si la carpeta está vacía o no se puede listar', async () => {
    await expect(limpiarHuerfanos(ORG, REP)).resolves.toBe(0)
    mocks.list.mockResolvedValue({ data: null, error: new Error('403') })
    await expect(limpiarHuerfanos(ORG, REP)).resolves.toBe(0)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('una subida rechazada limpia los huérfanos viejos y reintenta una sola vez', async () => {
    mocks.upload
      .mockResolvedValueOnce({ error: new Error('new row violates row-level security policy') })
      .mockResolvedValueOnce({ error: null })
    mocks.list.mockResolvedValue({ data: [{ name: 'huerfano.png', created_at: hace(EDAD_MINIMA_HUERFANO_MS * 2) }], error: null })
    mocks.rpc.mockImplementation(async (nombre: string) => (nombre === 'listar_adjuntos_reparacion' ? { data: [], error: null } : { data: null, error: null }))
    const promesa = subirAdjunto(ORG, REP, archivo, 'image/png')
    await vi.runAllTimersAsync()
    await promesa
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.remove).toHaveBeenCalledWith([`${ORG}/${REP}/huerfano.png`])
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_adjunto_reparacion', expect.objectContaining({ p_reparacion: REP, p_mime: 'image/png' }))
  })

  it('si no había huérfanos que limpiar, la subida rechazada falla sin reintentar', async () => {
    mocks.upload.mockResolvedValue({ error: new Error('tope') })
    const promesa = subirAdjunto(ORG, REP, archivo, 'image/png').catch((e: Error) => e)
    await vi.runAllTimersAsync()
    expect(((await promesa) as unknown as Error).message).toBe('tope')
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalledWith('registrar_adjunto_reparacion', expect.anything())
  })

  it('si el registro falla, borra el objeto recién subido y relanza el error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: Object.assign(new Error('55000'), { code: '55000' }) })
    const promesa = subirAdjunto(ORG, REP, archivo, 'image/png').catch((e: Error & { code?: string }) => e)
    await vi.runAllTimersAsync()
    expect(((await promesa) as unknown as { code?: string }).code).toBe('55000')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(String(mocks.remove.mock.calls[0][0][0])).toMatch(new RegExp(`^${ORG}/${REP}/[0-9a-f-]{36}\\.png$`))
  })
})
