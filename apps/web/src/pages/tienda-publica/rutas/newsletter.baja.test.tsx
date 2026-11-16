import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ baja: vi.fn() }))

vi.mock('../../../lib/tiendaNewsletter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaNewsletter')>()),
  darDeBajaNewsletter: mocks.baja,
}))
vi.mock('../seo/CabeceraSeo', () => ({ CabeceraSeo: () => null }))

import RutaBajaNewsletter from './newsletter.baja'

const TOKEN = 'cd'.repeat(32)
const abrir = () =>
  render(
    <MemoryRouter initialEntries={[`/newsletter/baja/${TOKEN}`]}>
      <Routes><Route path="/newsletter/baja/:token" element={<RutaBajaNewsletter />} /></Routes>
    </MemoryRouter>,
  )

describe('/newsletter/baja/:token', () => {
  beforeEach(() => vi.clearAllMocks())

  it('abrir el enlace no da de baja: pide un clic de confirmación', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Darme de baja' })).toBeEnabled()
    expect(mocks.baja).not.toHaveBeenCalled()
  })

  it('un clic confirma la baja con el token del enlace y muestra un mensaje genérico', async () => {
    mocks.baja.mockResolvedValue('hecha')
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByRole('heading', { name: 'Listo, no vas a recibir más correos' })).toBeInTheDocument()
    expect(mocks.baja).toHaveBeenCalledTimes(1)
    expect(mocks.baja).toHaveBeenCalledWith(TOKEN)
  })

  it('un enlace con forma inválida muestra «Enlace inválido»', async () => {
    mocks.baja.mockResolvedValue('invalida')
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByRole('heading', { name: 'Enlace inválido' })).toBeInTheDocument()
  })

  it('un fallo de red deja reintentar sin mostrar detalles técnicos', async () => {
    mocks.baja.mockResolvedValue('falla')
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos procesar la baja')
    expect(screen.getByRole('button', { name: 'Darme de baja' })).toBeEnabled()
  })
})
