import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { contraste, crearTemaTienda } from '../../../tema/temaTienda'
import { FILTROS_INICIALES } from '../../../lib/tiendaListado'

vi.mock('../../../lib/analiticaTienda', () => ({ registrarEventoTienda: vi.fn() }))

import { PanelFiltros } from '../catalogo/PanelFiltros'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'
import { FormularioContacto } from '../contacto/FormularioContacto'
import { Galeria } from '../ficha/Galeria'

// MSF-847 (revisión): los campos y la casilla recuperan un indicador de foco visible (WCAG 2.4.7) y los textos de apoyo
// («Sin imagen», placeholders) usan el gris secundario de la tienda, que llega a 4,5:1 (AA) sobre el fondo y sobre la superficie.
const tema = crearTemaTienda({ colorPrimario: '#A3111D', colorTexto: '#1A1A1A', colorFondo: '#FFFFFF', tipografiaTitulos: 'Barlow Condensed', tipografiaTexto: 'Barlow' })
const conTema = (ui: React.ReactNode) => <ThemeProvider theme={tema}><MemoryRouter>{ui}</MemoryRouter></ThemeProvider>
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')

// jsdom no calcula `outline-*` en getComputedStyle: se comprueba que el campo recibe la clase de foco de MUI y que la hoja que
// emotion inyectó trae el contorno sólido de 2 px en el color primario para esa clase.
const regla = (clase: string) => new RegExp(`\\.${clase}\\{[^}]*outline-style:solid;[^}]*outline-width:2px;[^}]*outline-color:#a3111d`, 'i')

describe('foco visible', () => {
  it.each(['Nombre', 'Correo o WhatsApp', 'Mensaje'])('el campo «%s» del formulario de contacto cambia borde y contorno al enfocarse', (rotulo) => {
    render(conTema(<FormularioContacto host="mundojc.localhost" />))
    const campo = screen.getByLabelText(rotulo)
    const raiz = campo.closest('.MuiInputBase-root') as HTMLElement
    expect(raiz).not.toHaveClass('Mui-focused')
    act(() => campo.focus())
    expect(raiz).toHaveClass('Mui-focused')
    expect(reglas()).toMatch(regla('Mui-focused'))
    expect(reglas()).toMatch(/\.Mui-focused\{[^}]*border-color:#a3111d/i)
  })

  it('el campo «Precio máximo» y la casilla «Solo con stock» muestran el foco', () => {
    render(conTema(
      <PanelFiltros categorias={[]} filtros={FILTROS_INICIALES} alElegirCategoria={vi.fn()} alCambiarStock={vi.fn()} alCambiarPrecioMax={vi.fn()} alLimpiar={vi.fn()} />,
    ))
    const precio = screen.getByRole('textbox', { name: 'Precio máximo' })
    act(() => precio.focus())
    expect(precio.closest('.MuiInputBase-root')).toHaveClass('Mui-focused')
    expect(reglas()).toMatch(regla('Mui-focused'))
    // La casilla es un ButtonBase: con el teclado (focus-visible) MUI le pone `Mui-focusVisible`.
    const casilla = screen.getByRole('button', { name: 'Solo con stock' })
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => casilla.focus())
    expect(casilla).toHaveClass('Mui-focusVisible')
    expect(reglas()).toMatch(regla('Mui-focusVisible'))
  })
})

describe('contraste AA de los textos de apoyo', () => {
  it('el gris secundario del tema llega a 4,5:1 sobre el fondo y sobre la superficie de las tarjetas', () => {
    const gris = tema.palette.text.secondary
    expect(contraste(gris, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(gris, tema.tienda!.superficie)).toBeGreaterThanOrEqual(4.5)
  })

  it('«Sin imagen» (tarjeta y ficha) usa ese gris, no un negro translúcido', () => {
    const base = { id: 'p-1', nombre: 'Joystick', precio: 100, precioAnterior: null, disponible: true, imagen: null, categoriaId: null, destacado: false }
    const { unmount } = render(conTema(<TarjetaProducto producto={base} />))
    expect(getComputedStyle(screen.getByText('Sin imagen')).color).toBe('rgb(106, 106, 106)')
    unmount()
    render(conTema(<Galeria imagenes={[]} urls={{}} nombre="Joystick" />))
    expect(getComputedStyle(screen.getByText('Sin imagen')).color).toBe('rgb(106, 106, 106)')
  })

  it('los placeholders del formulario y del precio máximo usan el gris secundario (no rgba(0,0,0,.45))', async () => {
    const { container } = render(conTema(<main><h1>Contacto</h1><FormularioContacto host="mundojc.localhost" /></main>))
    expect(reglas()).not.toContain('rgba(0,0,0,.45)')
    expect(reglas()).toMatch(/::placeholder\{color:#6a6a6a;opacity:1/i)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
