// MSF-797: la Edge Function responde 503 `plataforma_no_configurada` si la IP de la plataforma no es pública; el panel
// lo traduce a su propio motivo (y no al genérico «otro»).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { functions: { invoke: mocks.invoke } } }))

import { ErrorVerificarDominio, verificarDominio } from './tiendaDominio'

const errorHttp = (cuerpo: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { json: async () => cuerpo } })

describe('verificarDominio · motivos de fallo', () => {
  beforeEach(() => mocks.invoke.mockReset())

  it.each(['demasiado_pronto', 'dns_no_disponible', 'sin_permiso', 'plataforma_no_configurada'] as const)(
    'traduce «%s» a su motivo', async (codigo) => {
      mocks.invoke.mockResolvedValue({ data: null, error: errorHttp({ error: codigo }) })
      await expect(verificarDominio('e1')).rejects.toMatchObject({ motivo: codigo })
    })

  it('un código desconocido o un cuerpo ilegible cae en «otro»', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: errorHttp({ error: 'solicitud_invalida' }) })
    await expect(verificarDominio('e1')).rejects.toBeInstanceOf(ErrorVerificarDominio)
    await expect(verificarDominio('e1')).rejects.toMatchObject({ motivo: 'otro' })
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'x', context: { json: async () => { throw new Error('no json') } } } })
    await expect(verificarDominio('e1')).rejects.toMatchObject({ motivo: 'otro' })
  })
})
