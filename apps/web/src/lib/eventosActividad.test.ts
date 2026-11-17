import { afterEach, describe, expect, it, vi } from 'vitest'
import { calcularCambios, emitirEventoActividad, registrarDestinoActividad, type EventoActividad } from './eventosActividad'

const evento: EventoActividad = { tipo: 'empresa.actualizada', actorId: 'u1', empresaId: 'e1', cambios: [], fecha: '2026-11-17T00:00:00Z' }

describe('calcularCambios', () => {
  it('lista solo los campos que cambiaron, con su valor anterior y nuevo', () => {
    const antes = { nombre: 'A', telefono: '1', web: null as string | null }
    const despues = { nombre: 'B', telefono: '1', web: 'https://x.com' }
    expect(calcularCambios(antes, despues)).toEqual([
      { campo: 'nombre', antes: 'A', despues: 'B' },
      { campo: 'web', antes: null, despues: 'https://x.com' },
    ])
  })

  it('sin diferencias devuelve una lista vacía', () => {
    expect(calcularCambios({ a: 'x' }, { a: 'x' })).toEqual([])
  })
})

describe('emitirEventoActividad', () => {
  afterEach(() => registrarDestinoActividad(null))

  it('sin destino registrado no hace nada', async () => {
    await expect(emitirEventoActividad(evento)).resolves.toBeUndefined()
  })

  it('entrega el evento al destino registrado', async () => {
    const destino = vi.fn()
    registrarDestinoActividad(destino)
    await emitirEventoActividad(evento)
    expect(destino).toHaveBeenCalledWith(evento)
  })

  it('un destino que falla no rompe el guardado: deja una advertencia', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registrarDestinoActividad(() => Promise.reject(new Error('caído')))
    await expect(emitirEventoActividad(evento)).resolves.toBeUndefined()
    expect(aviso).toHaveBeenCalled()
    aviso.mockRestore()
  })
})
