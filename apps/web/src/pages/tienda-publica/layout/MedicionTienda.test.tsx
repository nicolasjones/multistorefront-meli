import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Link } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarConsentimiento, reiniciarConsentimientoEnMemoria } from '../../../lib/consentimientoCookies'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), cargar: vi.fn(), visita: vi.fn(), retirar: vi.fn() }))
vi.mock('../../../lib/analiticaTienda', async (original) => ({
  ...(await original<typeof import('../../../lib/analiticaTienda')>()),
  leerAnaliticaPublica: mocks.leer,
  cargarMedicion: mocks.cargar,
  registrarVisita: mocks.visita,
  retirarMedicion: mocks.retirar,
}))

import MedicionTienda from './MedicionTienda'

const IDS = { ga4_id: 'G-ABC123', meta_pixel_id: '123456789' }
const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <MedicionTienda host="www.mundojc.com.ar" />
      <Link to="/producto/1">ir al producto</Link>
    </MemoryRouter>,
  )

describe('MedicionTienda (F-TDA-24, FR-014, FR-015, FR-017)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    reiniciarConsentimientoEnMemoria()
    mocks.leer.mockResolvedValue(IDS)
  })

  it('no pinta nada en la tienda', () => {
    const { container } = abrir()
    // Solo el enlace de prueba: el componente de medición no agrega nodos propios.
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.children).toHaveLength(1)
  })

  it('sin decisión sobre las cookies no carga nada ni registra visitas', async () => {
    abrir()
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledTimes(1))
    expect(mocks.cargar).not.toHaveBeenCalled()
    expect(mocks.visita).not.toHaveBeenCalled()
  })

  it('con cookies rechazadas no carga nada', async () => {
    guardarConsentimiento('rechazadas')
    abrir()
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledTimes(1))
    expect(mocks.cargar).not.toHaveBeenCalled()
    expect(mocks.visita).not.toHaveBeenCalled()
  })

  it('con cookies aceptadas y IDs carga la medición y registra la visita de la ruta actual', async () => {
    guardarConsentimiento('aceptadas')
    abrir()
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(IDS))
    await waitFor(() => expect(mocks.visita).toHaveBeenCalledWith('/'))
    expect(mocks.leer).toHaveBeenCalledWith('www.mundojc.com.ar')
  })

  it('si la persona acepta con la página abierta, se carga en ese momento (aceptación tardía)', async () => {
    abrir()
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledTimes(1))
    expect(mocks.cargar).not.toHaveBeenCalled()

    act(() => guardarConsentimiento('aceptadas'))

    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(IDS))
    await waitFor(() => expect(mocks.visita).toHaveBeenCalledWith('/'))
  })

  it('una empresa sin IDs no carga nada aunque se acepten las cookies', async () => {
    mocks.leer.mockResolvedValue({ ga4_id: null, meta_pixel_id: null })
    guardarConsentimiento('aceptadas')
    abrir()
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledTimes(1))
    expect(mocks.cargar).not.toHaveBeenCalled()
    expect(mocks.visita).not.toHaveBeenCalled()
  })

  it('una tienda desconocida o desactivada (null) no carga nada', async () => {
    mocks.leer.mockResolvedValue(null)
    guardarConsentimiento('aceptadas')
    abrir()
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledTimes(1))
    expect(mocks.cargar).not.toHaveBeenCalled()
  })

  it('consulta los IDs una sola vez por visita y registra una visita por cada navegación', async () => {
    guardarConsentimiento('aceptadas')
    abrir()
    await waitFor(() => expect(mocks.visita).toHaveBeenCalledWith('/'))

    fireEvent.click(screen.getByRole('link', { name: 'ir al producto' }))

    await waitFor(() => expect(mocks.visita).toHaveBeenCalledWith('/producto/1'))
    expect(mocks.visita).toHaveBeenCalledTimes(2)
    expect(mocks.leer).toHaveBeenCalledTimes(1)
  })

  it('si la persona revoca con la página abierta, apaga la medición', async () => {
    guardarConsentimiento('aceptadas')
    abrir()
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(IDS))
    mocks.retirar.mockClear()
    act(() => guardarConsentimiento('rechazadas'))
    await waitFor(() => expect(mocks.retirar).toHaveBeenCalled())
  })

  it('al cambiar de host descarta los IDs del anterior y carga los del nuevo', async () => {
    guardarConsentimiento('aceptadas')
    const NUEVOS = { ga4_id: 'G-NUEVO99', meta_pixel_id: null }
    const vista = (host: string) => (
      <MemoryRouter initialEntries={['/']}>
        <MedicionTienda host={host} />
      </MemoryRouter>
    )
    const { rerender } = render(vista('a.com'))
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(IDS))
    mocks.leer.mockResolvedValue(NUEVOS)
    rerender(vista('b.com'))
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledWith('b.com'))
    await waitFor(() => expect(mocks.cargar).toHaveBeenLastCalledWith(NUEVOS))
    expect(mocks.retirar).toHaveBeenCalled()
  })
})
