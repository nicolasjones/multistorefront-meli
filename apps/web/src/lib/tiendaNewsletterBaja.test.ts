import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { functions: { invoke: mocks.invoke } } }))

import { darDeBajaNewsletter } from './tiendaNewsletter'

const TOKEN = 'cd'.repeat(32)

describe('darDeBajaNewsletter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a la Edge Function de baja con el token y sin cambiar su contrato', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await darDeBajaNewsletter(TOKEN)).toBe('hecha')
    expect(mocks.invoke).toHaveBeenCalledWith('baja-correo-masivo', { body: { token: TOKEN } })
  })

  it('un token con otra forma no se envía', async () => {
    for (const token of ['', 'abc', 'xx'.repeat(32), `${TOKEN}0`, 'AB'.repeat(32)]) {
      expect(await darDeBajaNewsletter(token)).toBe('invalida')
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('un error de la función o un corte de red responde falla sin detalle', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await darDeBajaNewsletter(TOKEN)).toBe('falla')
    mocks.invoke.mockRejectedValueOnce(new Error('red'))
    expect(await darDeBajaNewsletter(TOKEN)).toBe('falla')
  })
})
