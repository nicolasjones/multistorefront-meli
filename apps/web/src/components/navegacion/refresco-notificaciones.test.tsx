import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simularRpc as simular } from './pruebas-notificaciones'

const rpc = vi.hoisted(() => vi.fn())
const simularRpc = (o: Parameters<typeof simular>[1] = {}) => simular(rpc, o)

vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc } }
})

import { CampanitaNotificaciones } from './CampanitaNotificaciones'
import { INTERVALO_REFRESCO_MS } from './useNotificaciones'

function visibilidad(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado })
}

describe('Refresco del conteo (FR-009)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    simularRpc({ sinLeer: 1 })
    visibilidad('visible')
  })
  afterEach(() => { vi.useRealTimers(); visibilidad('visible') })

  const conteos = () => rpc.mock.calls.filter(([nombre]) => nombre === 'contar_notificaciones_sin_leer').length

  it('consulta al montar y cada 60 s con la pestaña visible', async () => {
    render(<CampanitaNotificaciones />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(conteos()).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_REFRESCO_MS) })
    expect(conteos()).toBe(2)
  })

  it('no consulta con la pestaña oculta y refresca al volver', async () => {
    render(<CampanitaNotificaciones />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    visibilidad('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_REFRESCO_MS * 3) })
    expect(conteos()).toBe(1)
    visibilidad('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(conteos()).toBe(2)
  })
})
