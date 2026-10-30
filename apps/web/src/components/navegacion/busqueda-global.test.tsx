import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc } }
})

import { BusquedaGlobal } from './BusquedaGlobal'

function Ubicacion() {
  return <p data-testid="ubicacion">{useLocation().pathname}</p>
}

function montar() {
  return render(
    <MemoryRouter>
      <Routes><Route path="*" element={<><BusquedaGlobal /><Ubicacion /></>} /></Routes>
    </MemoryRouter>,
  )
}

const PRODUCTOS = [
  { producto_id: 'p-1', nombre: 'Joystick inalámbrico', sku: 'JOY-100' },
  { producto_id: 'p-2', nombre: 'Joystick USB', sku: 'JOY-200' },
]

// [MSF-374:T019] [MSF-374:T020] [MSF-374:T021] [MSF-374:T022]
describe('BusquedaGlobal (F-INI-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: PRODUCTOS, error: null })
  })
  afterEach(() => { vi.useRealTimers() })

  async function escribir(texto: string) {
    const campo = screen.getByRole('combobox', { name: /buscar producto/i })
    fireEvent.change(campo, { target: { value: texto } })
    return campo
  }

  it('FR-030/031: muestra el campo y no consulta con menos de 2 caracteres', async () => {
    montar()
    await escribir('j')
    await new Promise((r) => setTimeout(r, 400))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('FR-031: con 2 o más caracteres consulta con debounce y lista los resultados', async () => {
    montar()
    await escribir('jo')
    await escribir('joy')
    expect(rpc).not.toHaveBeenCalled()
    expect(await screen.findByText('Joystick inalámbrico')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('buscar_productos_global', { p_q: 'joy' })
    expect(screen.getByText('JOY-200')).toBeInTheDocument()
  })

  it('FR-032: elegir un resultado abre el producto', async () => {
    montar()
    await escribir('joy')
    fireEvent.click(await screen.findByText('Joystick USB'))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/productos/p-2/edit')
  })

  it('FR-033: sin coincidencias muestra «No encontramos productos»', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    montar()
    await escribir('zzz')
    await waitFor(() => expect(screen.getAllByText('No encontramos productos').length).toBeGreaterThan(0))
  })

  it('FR-035: si falla muestra el error compartido, deja el campo y reintenta', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    montar()
    const campo = await escribir('joy')
    expect(await screen.findByText('No pudimos buscar productos.')).toBeInTheDocument()
    expect(campo).toHaveValue('joy')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Joystick inalámbrico')).toBeInTheDocument()
  })

  it('FR-036: anuncia cuántos resultados hay y se opera con teclado', async () => {
    montar()
    const campo = await escribir('joy')
    await screen.findByText('Joystick inalámbrico')
    expect(screen.getByRole('status')).toHaveTextContent('2 resultados')
    await act(async () => { fireEvent.keyDown(campo, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }) })
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/productos/p-1/edit')
  })

  it('FR-036: Escape cierra la lista', async () => {
    montar()
    const campo = await escribir('joy')
    await screen.findByText('Joystick inalámbrico')
    await act(async () => { fireEvent.keyDown(campo, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByText('Joystick inalámbrico')).not.toBeInTheDocument())
  })
})
