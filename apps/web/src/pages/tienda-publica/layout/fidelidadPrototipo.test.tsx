import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { crearTemaTienda } from '../../../tema/temaTienda'
import { ThemeProvider } from '@mui/material'
import { BannerContenido } from '../secciones/BannerHome'
import { DatosContacto } from '../contacto/DatosContacto'
import { EstadoVacioCatalogo } from '../catalogo/EstadoVacio'
import { ANCHO_MAXIMO_TIENDA } from './medidas'
import { MigasTienda } from './MigasTienda'

// MSF-847: piezas compartidas que fijan las medidas del prototipo (contenedor, migas, banner, contacto, estado vacío, tema).
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')
const tema = crearTemaTienda({ colorPrimario: '#A3111D', colorPrimarioOscuro: '#7A0A12', colorBarra: '#2A2A2A', tipografiaTitulos: 'Barlow Condensed', tipografiaTexto: 'Barlow' })
const conTema = (ui: React.ReactNode) => <ThemeProvider theme={tema}><MemoryRouter>{ui}</MemoryRouter></ThemeProvider>

describe('contenedor de la tienda', () => {
  it('el máximo suma 16 px de margen a cada lado de los 1200 px de contenido del prototipo', () => {
    expect(ANCHO_MAXIMO_TIENDA).toBe(1200 + 2 * 16)
  })
})

describe('tema de la tienda', () => {
  it('los títulos van en negrita con la tipografía de títulos, sin el espaciado entre letras de MUI; los botones sin mayúsculas, en negrita y con radio 8', () => {
    expect(tema.typography.h1.fontWeight).toBe(700)
    expect(tema.typography.h1.letterSpacing).toBe('normal')
    expect(tema.typography.h1.fontFamily).toContain('Barlow Condensed')
    expect(tema.typography.body1.lineHeight).toBe('normal')
    const boton = tema.components?.MuiButton?.styleOverrides?.root as Record<string, unknown>
    expect(boton).toMatchObject({ textTransform: 'none', fontWeight: 700, borderRadius: 8 })
  })
})

describe('MigasTienda', () => {
  it('lista «Inicio / Página» con enlaces sin subrayado y la página actual marcada (aria-current)', () => {
    render(<MemoryRouter><MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: 'Todos los productos', a: '/catalogo' }, { texto: 'Case OLED' }]} /></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: 'Migas de pan' })
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Todos los productos' })).toHaveAttribute('href', '/catalogo')
    expect(within(nav).getByText('Case OLED')).toHaveAttribute('aria-current', 'page')
    // El separador es decorativo (no lo lee un lector de pantalla).
    expect(nav.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(2)
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('BannerContenido', () => {
  it('franja con el color de la barra, título de 72 px en mayúsculas y botón primario de 16 px (como MJC_Home)', () => {
    render(conTema(<BannerContenido contenido={{ titulo: 'Todo para tu consola', subtitulo: 'Cargadores y más', texto_boton: 'Ver catálogo', boton_destino: 'catalogo' }} />))
    const banner = screen.getByTestId('banner-home')
    // La franja a todo el ancho es una capa propia (100vw, recortada) que lleva el color de la barra y las franjas inclinadas.
    const capa = within(banner).getByTestId('banner-capa')
    expect(getComputedStyle(capa).backgroundColor).toBe('rgb(42, 42, 42)')
    expect(getComputedStyle(capa).width).toBe(`${window.innerWidth}px`) // jsdom resuelve 100vw a la ventana
    expect(getComputedStyle(capa).overflow).toBe('hidden')
    expect(capa.children).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 2, name: 'Todo para tu consola' })).toBeInTheDocument()
    expect(reglas()).toMatch(/@media \(min-width:900px\)\{[^}]*font-size:72px/)
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo')
  })

  it('en la vista previa del panel la franja no se extiende fuera de su recuadro', () => {
    render(conTema(<BannerContenido vistaPrevia contenido={{ titulo: 'Hola', subtitulo: '', texto_boton: '', boton_destino: 'catalogo' }} />))
    expect(screen.queryByTestId('banner-capa')).not.toBeInTheDocument()
  })
})

describe('DatosContacto', () => {
  it('cada bloque lleva su círculo con glifo decorativo y el rótulo como encabezado', () => {
    const { container } = render(conTema(<DatosContacto contacto={{ nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'a@b.com', horarios: 'Lunes a viernes' }} />))
    expect(container.querySelectorAll('section > span[aria-hidden="true"] svg')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 2, name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Retiro y envíos' })).toBeInTheDocument()
  })
})

describe('EstadoVacioCatalogo', () => {
  it('«No hay productos con esos filtros», recuadro punteado y botón «Limpiar filtros»', async () => {
    const { container } = render(conTema(<main><h1>Catálogo</h1><EstadoVacioCatalogo alLimpiar={() => undefined} /></main>))
    expect(screen.getByRole('heading', { name: 'No hay productos con esos filtros' })).toBeInTheDocument()
    expect(reglas()).toMatch(/border:1\.5px dashed rgba\(0,0,0,\.15\)/)
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
