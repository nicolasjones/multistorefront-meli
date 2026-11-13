import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { contraste, crearTemaTienda, UMBRAL_BOTON } from '../../../tema/temaTienda'
import { ThemeProvider } from '@mui/material'
import { BannerContenido } from '../secciones/BannerHome'
import { DatosContacto } from '../contacto/DatosContacto'
import { EstadoVacioCatalogo } from '../catalogo/EstadoVacio'
import { ContextoEnLayout } from './enLayout'
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

describe('tema: botón del héroe y papel (MSF-847, auditoría)', () => {
  const identidades = {
    mundoJc: { colorPrimario: '#A3111D', colorAcento: '#A3111D', colorBarra: '#2A2A2A', colorTexto: '#1F1F1F', colorFondo: '#FFFFFF' },
    sanJavucho: { colorPrimario: '#1B3A5C', colorAcento: '#E9A23B', colorBarra: '#1B3A5C', colorTexto: '#1B2430', colorFondo: '#FBF8F2' },
    // Acento casi igual a la franja: el botón no puede quedar invisible (antes: primario sobre primario, 1:1).
    acentoIgualALaFranja: { colorPrimario: '#1B3A5C', colorAcento: '#1B3A5C', colorBarra: '#1B3A5C', colorTexto: '#1B2430', colorFondo: '#FBF8F2' },
    franjaClara: { colorPrimario: '#2E6B3F', colorAcento: '#2E6B3F', colorBarra: '#F1E9D8', colorTexto: '#22281F', colorFondo: '#FAF7F0' },
  }
  it.each(Object.entries(identidades))('«%s»: el botón se distingue de la franja (≥ 1,5:1; antes 1:1), el texto del botón y el de la franja llegan a AA', (_nombre, identidad) => {
    const t = crearTemaTienda(identidad)
    const { botonDestacado, barra, textoBarra } = t.tienda!
    expect(contraste(botonDestacado.fondo, barra)).toBeGreaterThanOrEqual(1.5)
    expect(contraste(botonDestacado.texto, botonDestacado.fondo)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(textoBarra, barra)).toBeGreaterThanOrEqual(4.5)
  })
  // Identidades extremas (revisión): franja blanca, negra y gris medio; acentos muy claros u oscuros con la franja contraria; y el
  // límite del umbral (1,5:1) de un lado y del otro.
  const base = { colorPrimario: '#2E6B3F', colorTexto: '#1A1A1A', colorFondo: '#FFFFFF' }
  const extremas: Array<[string, { colorAcento: string; colorBarra: string }]> = [
    ['franja blanca, acento claro', { colorBarra: '#FFFFFF', colorAcento: '#F5F5F5' }],
    ['franja blanca, acento oscuro', { colorBarra: '#FFFFFF', colorAcento: '#111111' }],
    ['franja negra, acento oscuro', { colorBarra: '#000000', colorAcento: '#0A0A0A' }],
    ['franja negra, acento muy claro', { colorBarra: '#000000', colorAcento: '#FFF3C4' }],
    ['franja gris medio, acento gris medio', { colorBarra: '#808080', colorAcento: '#858585' }],
    ['franja gris medio, acento amarillo', { colorBarra: '#808080', colorAcento: '#FFD500' }],
    ['franja oscura, acento muy claro', { colorBarra: '#202020', colorAcento: '#FAFAFA' }],
    ['franja clara, acento muy oscuro', { colorBarra: '#F1E9D8', colorAcento: '#050505' }],
  ]
  it.each(extremas)('identidad extrema «%s»: el botón nunca se confunde con la franja y todos los textos llegan a AA', (_nombre, ids) => {
    const { botonDestacado, barra, textoBarra } = crearTemaTienda({ ...base, ...ids }).tienda!
    expect(contraste(botonDestacado.fondo, barra)).toBeGreaterThanOrEqual(UMBRAL_BOTON)
    expect(contraste(botonDestacado.texto, botonDestacado.fondo)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(textoBarra, barra)).toBeGreaterThanOrEqual(4.5)
  })

  it('límite del umbral: con un acento justo por encima de 1,5:1 se usa el acento; justo por debajo, el color del texto de la franja', () => {
    const barra = '#808080'
    const grises = Array.from({ length: 256 }, (_, n) => `#${n.toString(16).padStart(2, '0').repeat(3)}`)
    const arriba = grises.filter((g) => contraste(g, barra) >= UMBRAL_BOTON && contraste(g, barra) < UMBRAL_BOTON + 0.02)[0]
    const abajo = grises.filter((g) => contraste(g, barra) < UMBRAL_BOTON && contraste(g, barra) > UMBRAL_BOTON - 0.02).slice(-1)[0]
    expect(arriba).toBeDefined()
    expect(abajo).toBeDefined()
    const t1 = crearTemaTienda({ ...base, colorBarra: barra, colorAcento: arriba }).tienda!
    expect(t1.botonDestacado.fondo.toLowerCase()).toBe(arriba)
    const t2 = crearTemaTienda({ ...base, colorBarra: barra, colorAcento: abajo }).tienda!
    expect(t2.botonDestacado.fondo).toBe(t2.textoBarra)
    expect(contraste(t2.botonDestacado.fondo, barra)).toBeGreaterThanOrEqual(UMBRAL_BOTON)
  })

  it('San Javucho usa el acento con texto de tinta; MundoJC, su primario con texto blanco', () => {
    expect(crearTemaTienda(identidades.sanJavucho).tienda!.botonDestacado).toEqual({ fondo: '#E9A23B', texto: '#1B2430' })
    expect(crearTemaTienda(identidades.mundoJc).tienda!.botonDestacado).toEqual({ fondo: '#A3111D', texto: '#FFFFFF' })
  })
  it('el papel (encabezado, campos, menús, diálogos) es blanco aunque el fondo de la tienda sea crema', () => {
    const t = crearTemaTienda(identidades.sanJavucho)
    expect(t.palette.background.paper).toBe('#FFFFFF')
    expect(t.palette.background.default).toBe('#FBF8F2')
  })
  it('el botón del banner usa esos colores (San Javucho: acento sobre la franja azul)', () => {
    const t = crearTemaTienda(identidades.sanJavucho)
    render(<ThemeProvider theme={t}><MemoryRouter><BannerContenido contenido={{ titulo: 'Hola', subtitulo: '', texto_boton: 'Explorar productos', boton_destino: 'catalogo' }} /></MemoryRouter></ThemeProvider>)
    const boton = screen.getByRole('link', { name: 'Explorar productos' })
    expect(getComputedStyle(boton).backgroundColor).toBe('rgb(233, 162, 59)')
    expect(getComputedStyle(boton).color).toBe('rgb(27, 36, 48)')
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
    // Fuera del layout (vista previa, secciones sueltas) el título es h2; dentro del layout es el h1 de la portada (prototipo).
    expect(screen.getByRole('heading', { level: 2, name: 'Todo para tu consola' })).toBeInTheDocument()
    expect(reglas()).toMatch(/@media \(min-width:900px\)\{[^}]*font-size:72px/)
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo')
  })

  it('dentro del layout de la tienda el título del héroe es el h1 de la portada', () => {
    render(conTema(<ContextoEnLayout.Provider value><BannerContenido contenido={{ titulo: 'Hola', subtitulo: '', texto_boton: '', boton_destino: 'catalogo' }} /></ContextoEnLayout.Provider>))
    expect(screen.getByRole('heading', { level: 1, name: 'Hola' })).toBeInTheDocument()
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
