import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { contarFiltrosActivos, FILTROS_INICIALES, type FiltrosCatalogo } from '../../../lib/tiendaListado'
import PanelFiltrosMovil from './PanelFiltrosMovil'

// F-TDA-17 (SC-007, FR-041/FR-048): «Filtrar·N», panel «Filtros» con Limpiar, Categoría, «Solo con stock»,
// «Precio máximo» (D5) y Ordenar, «Ver N productos», foco devuelto y cantidad anunciada.

const CAT_A = 'ca000000-0000-4000-8000-00000000000a'
const categorias = [{ id: CAT_A, nombre: 'Joysticks', padreId: null, productos: 3 }]

function montar(filtros: Partial<FiltrosCatalogo> = {}, extra: { total?: number | null; categoriaFija?: boolean } = {}) {
  const acciones = {
    alElegirCategoria: vi.fn(),
    alCambiarStock: vi.fn(),
    alCambiarPrecioMax: vi.fn(),
    alCambiarOrden: vi.fn(),
    alLimpiar: vi.fn(),
  }
  const vista = render(
    <PanelFiltrosMovil
      categorias={categorias}
      filtros={{ ...FILTROS_INICIALES, ...filtros }}
      total={extra.total === undefined ? 5 : extra.total}
      categoriaFija={extra.categoriaFija ?? false}
      {...acciones}
    />,
  )
  return { ...vista, acciones }
}

const abrir = () => fireEvent.click(screen.getByTestId('filtrar-movil'))

describe('Contador de filtros activos (FR-041)', () => {
  it('cuenta categoría, stock y precio; el orden no cuenta y la categoría fija por path tampoco', () => {
    expect(contarFiltrosActivos(FILTROS_INICIALES, false)).toBe(0)
    expect(contarFiltrosActivos({ ...FILTROS_INICIALES, categoria: CAT_A, soloConStock: true, precioMax: 100, orden: 'precio_asc' }, false)).toBe(3)
    expect(contarFiltrosActivos({ ...FILTROS_INICIALES, categoria: CAT_A, soloConStock: true }, true)).toBe(1)
  })
})

describe('Panel de filtros móvil (FR-041, FR-048)', () => {
  it('sin filtros activos el botón dice «Filtrar» y no anuncia cantidad', () => {
    montar()
    const boton = screen.getByTestId('filtrar-movil')
    expect(boton).toHaveTextContent('Filtrar')
    expect(boton).not.toHaveTextContent('activo')
    expect(boton).toHaveAttribute('aria-expanded', 'false')
  })

  it('con filtros activos muestra «· N» y lo anuncia a lector de pantalla', () => {
    montar({ soloConStock: true, precioMax: 5000 })
    const boton = screen.getByTestId('filtrar-movil')
    expect(boton).toHaveTextContent('Filtrar· 2')
    expect(boton).toHaveTextContent('2 filtros activos')
  })

  it('abre el panel «Filtros» con Limpiar, Categorías, Solo con stock, Precio máximo y Ordenar', async () => {
    montar()
    abrir()
    const panel = await screen.findByRole('dialog', { name: 'Filtros' })
    expect(screen.getByTestId('filtrar-movil')).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByRole('button', { name: 'Limpiar' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Categorías' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Joysticks 3 productos' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Solo con stock' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(panel).getByRole('textbox', { name: 'Precio máximo' })).toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: 'Ordenar por' })).toBeInTheDocument()
    // «Limpiar filtros» de escritorio no se duplica en el panel.
    expect(within(panel).queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })

  it('los controles llaman a las mismas acciones que escritorio', async () => {
    const { acciones } = montar()
    abrir()
    const panel = await screen.findByRole('dialog')
    fireEvent.click(within(panel).getByRole('button', { name: 'Solo con stock' }))
    expect(acciones.alCambiarStock).toHaveBeenCalledWith(true)
    fireEvent.click(within(panel).getByRole('button', { name: 'Joysticks 3 productos' }))
    expect(acciones.alElegirCategoria).toHaveBeenCalledWith(CAT_A)
    const precio = within(panel).getByRole('textbox', { name: 'Precio máximo' })
    fireEvent.change(precio, { target: { value: '12.000' } })
    fireEvent.blur(precio)
    expect(acciones.alCambiarPrecioMax).toHaveBeenCalledWith(12000)
    fireEvent.click(within(panel).getByRole('button', { name: 'Limpiar' }))
    expect(acciones.alLimpiar).toHaveBeenCalledTimes(1)
  })

  it('«Ver N productos» rotula con el total y cierra el panel devolviendo el foco al botón', async () => {
    montar({}, { total: 7 })
    const disparador = screen.getByTestId('filtrar-movil')
    disparador.focus()
    abrir()
    const panel = await screen.findByRole('dialog')
    fireEvent.click(within(panel).getByRole('button', { name: 'Ver 7 productos' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(disparador).toHaveFocus())
  })

  it('rotula singular y mientras carga', async () => {
    const { unmount } = montar({}, { total: 1 })
    abrir()
    expect(await screen.findByRole('button', { name: 'Ver 1 producto' })).toBeInTheDocument()
    unmount()
    montar({}, { total: null })
    abrir()
    expect(await screen.findByRole('button', { name: 'Ver productos' })).toBeInTheDocument()
  })

  it('se cierra con Esc y con «Cerrar filtros»', async () => {
    montar()
    abrir()
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar filtros' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('no tiene violaciones de accesibilidad, cerrado ni abierto', async () => {
    const { container } = montar({ soloConStock: true })
    expect(await violacionesAxe(container)).toEqual([])
    abrir()
    await screen.findByRole('dialog')
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
