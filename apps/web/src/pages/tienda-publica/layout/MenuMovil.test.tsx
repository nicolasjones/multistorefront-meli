import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import MenuMovil from './MenuMovil'

// F-TDA-17 (SC-007, FR-040/FR-048): «Inicio» y categorías con la actual marcada, cierre por botón, Esc,
// tocar afuera y navegación, foco devuelto al botón, estado expandido anunciado y sin «Contacto» (D10).

const CAT_A = 'ca000000-0000-4000-8000-00000000000a'
const CAT_B = 'ca000000-0000-4000-8000-00000000000b'
const lista = (extra: Record<string, unknown> = {}): CategoriasTienda => ({
  fase: 'lista' as const,
  categorias: [{ id: CAT_A, nombre: 'Joysticks', padreId: null, productos: 3 }, { id: CAT_B, nombre: 'Cargadores', padreId: null, productos: 1 }],
  reintentar: () => undefined,
  ...extra,
})

function montar(categorias: CategoriasTienda = lista(), entrada = '/') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="*" element={<MenuMovil categorias={categorias} />} />
      </Routes>
    </MemoryRouter>,
  )
}

const boton = () => screen.getByRole('button', { name: 'Abrir menú', hidden: true })

describe('Menú móvil (FR-040)', () => {
  it('cerrado: botón con aria-expanded=false y sin panel', () => {
    montar()
    expect(boton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('abierto: «Inicio» y «Categorías» con una entrada por categoría y la actual marcada', async () => {
    montar(lista(), `/categoria/${CAT_B}`)
    fireEvent.click(boton())
    const panel = await screen.findByRole('dialog', { name: 'Menú' })
    expect(boton()).toHaveAttribute('aria-expanded', 'true')
    const nav = within(panel).getByRole('navigation', { name: 'Menú de la tienda' })
    expect(within(nav).getByRole('heading', { name: 'Categorías' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Joysticks' })).toHaveAttribute('href', `/categoria/${CAT_A}`)
    expect(within(nav).getByRole('link', { name: 'Cargadores' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Joysticks' })).not.toHaveAttribute('aria-current')
  })

  it('ofrece «Contacto», que lleva a /contacto (F-TDA-16, FR-010)', async () => {
    montar()
    fireEvent.click(boton())
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByRole('link', { name: 'Contacto' })).toHaveAttribute('href', '/contacto')
  })

  it('se cierra con el botón «Cerrar menú» y devuelve el foco al botón que lo abrió', async () => {
    montar()
    boton().focus()
    fireEvent.click(boton())
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar menú' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(boton()).toHaveFocus())
    expect(boton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('se cierra con Esc', async () => {
    montar()
    fireEvent.click(boton())
    const panel = await screen.findByRole('dialog')
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('se cierra al tocar afuera (fondo)', async () => {
    montar()
    fireEvent.click(boton())
    await screen.findByRole('dialog')
    const fondo = document.querySelector('.MuiBackdrop-root') as HTMLElement
    fireEvent.click(fondo)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('se cierra al navegar a una categoría', async () => {
    montar()
    fireEvent.click(boton())
    fireEvent.click(await screen.findByRole('link', { name: 'Joysticks' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('con error de red muestra el aviso con «Reintentar» que repite el pedido', async () => {
    const reintentar = vi.fn()
    montar(lista({ fase: 'error', categorias: [], reintentar }))
    fireEvent.click(boton())
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('alert')).toHaveTextContent('No pudimos cargar las categorías.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }))
    expect(reintentar).toHaveBeenCalledTimes(1)
    // «Inicio» sigue disponible.
    expect(within(panel).getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad, cerrado ni abierto', async () => {
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(boton())
    await screen.findByRole('dialog')
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
