import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirmar: vi.fn() }))

vi.mock('../../../lib/tiendaNewsletter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaNewsletter')>()),
  confirmarNewsletter: mocks.confirmar,
}))
vi.mock('../layout/LayoutTienda', () => ({ useContextoTienda: () => ({ host: 'mundojc.localhost' }) }))
vi.mock('../seo/CabeceraSeo', () => ({ CabeceraSeo: () => null }))

import RutaConfirmarNewsletter from './newsletter.confirmar'

const TOKEN = 'ab'.repeat(32)
const abrir = () =>
  render(
    <MemoryRouter initialEntries={[`/newsletter/confirmar/${TOKEN}`]}>
      <Routes><Route path="/newsletter/confirmar/:token" element={<RutaConfirmarNewsletter />} /></Routes>
    </MemoryRouter>,
  )

// MSF-468 (RF-NL-5, CA-NL-5).
describe('/newsletter/confirmar/:token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('éxito: «Listo, ya estás suscripto» y confirma una sola vez con el host y el token', async () => {
    mocks.confirmar.mockResolvedValue('ok')
    abrir()
    expect(await screen.findByRole('heading', { name: 'Listo, ya estás suscripto' })).toBeInTheDocument()
    expect(mocks.confirmar).toHaveBeenCalledTimes(1)
    expect(mocks.confirmar).toHaveBeenCalledWith('mundojc.localhost', TOKEN)
    expect(screen.queryByRole('link', { name: 'Volver al pie de la tienda' })).toBeNull()
  })

  it('con StrictMode (doble efecto en desarrollo) no queda cargando para siempre', async () => {
    mocks.confirmar.mockResolvedValue('ok')
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/newsletter/confirmar/${TOKEN}`]}>
          <Routes><Route path="/newsletter/confirmar/:token" element={<RutaConfirmarNewsletter />} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    )
    expect(await screen.findByRole('heading', { name: 'Listo, ya estás suscripto' })).toBeInTheDocument()
  })

  it('CA-NL-5: vencido muestra «El enlace venció» y ofrece volver al pie', async () => {
    mocks.confirmar.mockResolvedValue('vencido')
    abrir()
    expect(await screen.findByRole('heading', { name: 'El enlace venció' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al pie de la tienda' })).toHaveAttribute('href', '/#newsletter-suscripcion')
  })

  it('inválido muestra «Enlace inválido» y ofrece volver al pie', async () => {
    mocks.confirmar.mockResolvedValue('invalido')
    abrir()
    expect(await screen.findByRole('heading', { name: 'Enlace inválido' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al pie de la tienda' })).toBeInTheDocument()
  })

  it('falla de red: ofrece «Reintentar» que vuelve a confirmar', async () => {
    mocks.confirmar.mockResolvedValueOnce('falla').mockResolvedValue('ok')
    abrir()
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' })
    reintentar.click()
    await waitFor(() => expect(mocks.confirmar).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'Listo, ya estás suscripto' })).toBeInTheDocument()
  })
})
