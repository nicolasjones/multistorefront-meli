import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { violacionesAxe } from '../test/axe'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { functions: { invoke: mocks.invoke } } }))

import { BajaCorreoPage } from './baja-correo'

const abrir = (token = 'abc123') => render(
  <MemoryRouter initialEntries={[`/baja-correo/${token}`]}>
    <Routes><Route path="/baja-correo/:token" element={<BajaCorreoPage />} /></Routes>
  </MemoryRouter>,
)

// FR-019: la página pública de baja confirma, llama a la Edge Function y responde siempre con un mensaje genérico.
describe('Página pública de baja del correo masivo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
  })

  it('pide confirmar y no da de baja solo por abrir el enlace', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Darte de baja del correo masivo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Darme de baja' })).toBeInTheDocument()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('al confirmar manda el token a la Edge Function y muestra la confirmación', async () => {
    abrir('tokenunico')
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('baja-correo-masivo', { body: { token: 'tokenunico' } }))
    expect(await screen.findByText(/no vas a recibir más correos masivos/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Darme de baja' })).not.toBeInTheDocument()
  })

  it('un token inexistente responde igual que uno válido: el mensaje no revela si el enlace existía', async () => {
    // La Edge Function responde { ok: true } también ante un token desconocido: la página no distingue.
    abrir('token-que-no-existe')
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByText(/no vas a recibir más correos masivos/)).toBeInTheDocument()
  })

  it('un fallo de red muestra un error genérico y permite reintentar', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom interno' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos procesar la baja. Probá de nuevo en un rato.')
    expect(screen.queryByText(/boom interno/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Darme de baja' }))
    expect(await screen.findByText(/no vas a recibir más correos masivos/)).toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = abrir()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
