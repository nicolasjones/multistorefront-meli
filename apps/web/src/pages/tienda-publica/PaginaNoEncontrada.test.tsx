import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.mock('../../lib/tiendaBusqueda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaBusqueda')>()),
  leerSugerencias: vi.fn(),
}))

import { PaginaNoEncontrada } from './PaginaNoEncontrada'
import BuscadorTienda from './layout/BuscadorTienda'

const CONTEXTO = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: {} }

// Imita el layout: buscador del encabezado + la 404 en el Outlet con el contexto de la tienda.
function Layout() {
  return (
    <>
      <header><BuscadorTienda host={CONTEXTO.host} /></header>
      <main><Outlet context={CONTEXTO} /></main>
    </>
  )
}

const montar = () => render(
  <MemoryRouter initialEntries={['/no-existe']}>
    <Routes><Route element={<Layout />}><Route path="*" element={<PaginaNoEncontrada />} /></Route></Routes>
  </MemoryRouter>,
)

// F-TDA-19 (FR-003, FR-005, SC-001): 404 con buscador, mismo mensaje y sin ids ni roles duplicados.
describe('PaginaNoEncontrada (FR-003)', () => {
  it('conserva el mensaje y «Volver al inicio» y suma el buscador en el cuerpo', async () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
    const cuerpo = screen.getByTestId('buscador-no-encontrada')
    await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Buscar productos' })).toHaveLength(2))
    expect(cuerpo.querySelector('input')).not.toBeNull()
  })

  it('sin tienda en el contexto no muestra el buscador pero sí el mensaje', () => {
    render(<MemoryRouter><PaginaNoEncontrada /></MemoryRouter>)
    expect(screen.getByText('No encontramos esta página')).toBeInTheDocument()
    expect(screen.queryByTestId('buscador-no-encontrada')).not.toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad ni ids duplicados con el buscador del encabezado', async () => {
    const { container } = montar()
    await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Buscar productos' })).toHaveLength(2))
    expect(await violacionesAxe(container)).toEqual([])
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
