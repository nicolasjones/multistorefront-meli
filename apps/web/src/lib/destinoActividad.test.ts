import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { detalleDeEvento, enviarEventoAlRegistro, instalarDestinoActividad } from './destinoActividad'
import { emitirEventoActividad, registrarDestinoActividad, type EventoActividad } from './eventosActividad'

const evento = (sobre: Partial<EventoActividad> = {}): EventoActividad => ({
  tipo: 'empresa.actualizada',
  actorId: 'u-1',
  empresaId: 'e-1',
  cambios: [{ campo: 'whatsapp', antes: '1', despues: '2' }, { campo: 'direccion', antes: null, despues: 'Calle 1' }],
  fecha: '2026-10-01T10:00:00Z',
  ...sobre,
})

describe('destino de actividad (F-AUD-01, FR-007)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    registrarDestinoActividad(null)
  })

  it('arma el detalle legible de cada evento de empresa', () => {
    expect(detalleDeEvento(evento())).toBe('Se actualizaron los datos de la empresa (campos: WhatsApp, dirección)')
    expect(detalleDeEvento(evento({ cambios: [] }))).toBe('Se guardaron los datos de la empresa')
    expect(detalleDeEvento(evento({ tipo: 'empresa.pausada' }))).toBe('Se pausó la tienda')
    expect(detalleDeEvento(evento({ tipo: 'empresa.reactivada' }))).toBe('Se reactivó la tienda')
  })

  it('registra solo tipo, detalle y empresa: organización y actor los pone el servidor', async () => {
    mocks.rpc.mockResolvedValue({ data: 'id', error: null })
    await enviarEventoAlRegistro(evento({ tipo: 'empresa.pausada' }))

    expect(mocks.rpc).toHaveBeenCalledWith('registrar_actividad', {
      p_tipo: 'empresa.pausada',
      p_detalle: 'Se pausó la tienda',
      p_empresa_id: 'e-1',
    })
  })

  it('al instalarlo, quien emite no cambia: el evento llega a la RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: 'id', error: null })
    instalarDestinoActividad()
    await emitirEventoActividad(evento({ tipo: 'empresa.reactivada' }))

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('un fallo del registro no rompe la edición ya guardada', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    instalarDestinoActividad()

    await expect(emitirEventoActividad(evento())).resolves.toBeUndefined()
    expect(aviso).toHaveBeenCalled()
    aviso.mockRestore()
  })
})
