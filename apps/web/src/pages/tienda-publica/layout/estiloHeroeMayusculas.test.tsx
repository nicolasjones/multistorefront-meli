import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { violacionesAxe } from '../../../test/axe'
import { celular } from '../../../test/matchMedia'
import { contraste, crearTemaTienda, UMBRAL_BOTON } from '../../../tema/temaTienda'
import { BannerContenido } from '../secciones/BannerHome'
import { MenuCategorias } from './MenuCategorias'

// MSF-848: estilo del encabezado de la portada (oscuro | claro) y mayúsculas de títulos y botones, por identidad.
const MJC = { colorPrimario: '#A3111D', colorPrimarioOscuro: '#7A0A12', colorAcento: '#A3111D', colorBarra: '#2A2A2A', colorTexto: '#1F1F1F', colorFondo: '#FFFFFF' }
const SJ = { colorPrimario: '#1B3A5C', colorPrimarioOscuro: '#122841', colorAcento: '#E9A23B', colorBarra: '#1B3A5C', colorTexto: '#1B2430', colorFondo: '#FBF8F2' }
const CONTENIDO = { titulo: 'Elegí lo que necesitás', subtitulo: 'Accesorios seleccionados para tu consola.', texto_boton: 'Explorar productos', boton_destino: 'catalogo' as const }
const CATEGORIAS = {
  fase: 'lista' as const,
  categorias: [{ id: 'c-1', nombre: 'Cargadores', padreId: null, productos: 2, imagen: null }, { id: 'c-2', nombre: 'Joysticks', padreId: null, productos: 1, imagen: null }],
  reintentar: () => undefined,
}
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')
const montar = (identidad: Parameters<typeof crearTemaTienda>[0], ui: React.ReactNode) =>
  render(<ThemeProvider theme={crearTemaTienda(identidad)}><MemoryRouter>{ui}</MemoryRouter></ThemeProvider>)

afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

describe('tema: estilo del encabezado y mayúsculas', () => {
  it('por defecto (identidad sin los campos nuevos): estilo oscuro, mayúsculas sí y franja con el color de la barra', () => {
    const t = crearTemaTienda(MJC).tienda!
    expect(t.heroe).toEqual({ estilo: 'oscuro', fondo: '#2A2A2A', texto: t.textoBarra, circulo: null })
    expect(t.titulosMayusculas).toBe(true)
  })
  it('estilo claro: franja con la superficie, texto en el primario y círculo del acento', () => {
    const t = crearTemaTienda({ ...SJ, estiloHeroe: 'claro', titulosMayusculas: false }).tienda!
    expect(t.heroe).toMatchObject({ estilo: 'claro', fondo: t.superficie, texto: '#1B3A5C', circulo: '#E9A23B' })
    expect(t.titulosMayusculas).toBe(false)
  })
  it('la miniatura del panel y la tienda derivan la franja clara del mismo tema (no se desvían)', () => {
    const t = crearTemaTienda({ ...SJ, estiloHeroe: 'claro' }).tienda!
    expect(t.heroe.fondo).toBe(t.superficie)
    expect(contraste(t.heroe.texto, t.heroe.fondo)).toBeGreaterThanOrEqual(4.5)
  })
  it('un valor fuera de la lista cae al estilo oscuro (nada inyectable)', () => {
    const t = crearTemaTienda({ ...SJ, estiloHeroe: 'verde' as never }).tienda!
    expect(t.heroe.estilo).toBe('oscuro')
  })
  // Identidades extremas del estilo claro: el texto de la franja llega a AA y el botón nunca se confunde con ella.
  // La identidad de producción nunca trae `colorTexto` (no es parte de la identidad): se prueba sin él, con el texto por defecto del tema.
  const SJ_SIN_TEXTO = { colorPrimario: SJ.colorPrimario, colorPrimarioOscuro: SJ.colorPrimarioOscuro, colorAcento: SJ.colorAcento, colorBarra: SJ.colorBarra, colorFondo: SJ.colorFondo }
  const extremas: Array<[string, Parameters<typeof crearTemaTienda>[0]]> = [
    ['primario muy claro', { ...SJ_SIN_TEXTO, colorPrimario: '#F5F5F5', colorAcento: '#F5F5F5' }],
    ['primario negro, acento negro', { ...SJ_SIN_TEXTO, colorPrimario: '#000000', colorAcento: '#000000' }],
    ['fondo blanco, acento blanco', { ...SJ_SIN_TEXTO, colorFondo: '#FFFFFF', colorAcento: '#FFFFFF' }],
    ['fondo negro, primario oscuro', { ...SJ_SIN_TEXTO, colorFondo: '#000000', colorPrimario: '#101010', colorAcento: '#050505' }],
    ['fondo azul muy oscuro (#0B1B3A), primario azul', { ...SJ_SIN_TEXTO, colorFondo: '#0B1B3A', colorPrimario: '#1B3A5C', colorAcento: '#E9A23B' }],
    ['fondo gris medio, acento gris medio', { ...SJ_SIN_TEXTO, colorFondo: '#808080', colorAcento: '#858585', colorPrimario: '#7A7A7A' }],
    ['acento igual a la superficie', { ...SJ_SIN_TEXTO, colorAcento: '#F0EDE8' }],
  ]
  it.each(extremas)('estilo claro, identidad extrema «%s»: texto de la franja y del botón a AA y botón distinto de la franja', (_n, identidad) => {
    const { heroe, botonDestacado } = crearTemaTienda({ ...identidad, estiloHeroe: 'claro' }).tienda!
    expect(contraste(heroe.texto, heroe.fondo)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(botonDestacado.fondo, heroe.fondo)).toBeGreaterThanOrEqual(UMBRAL_BOTON)
    expect(contraste(botonDestacado.texto, botonDestacado.fondo)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('héroe: variante oscura (MJC_Home)', () => {
  it('franja con el color de la barra, título de 72 px en mayúsculas, botón en mayúsculas y franjas inclinadas, sin círculo', () => {
    montar({ ...MJC, estiloHeroe: 'oscuro', titulosMayusculas: true }, <BannerContenido contenido={CONTENIDO} />)
    const banner = screen.getByTestId('banner-home')
    expect(banner).toHaveAttribute('data-estilo', 'oscuro')
    const capa = within(banner).getByTestId('banner-capa')
    expect(getComputedStyle(capa).backgroundColor).toBe('rgb(42, 42, 42)')
    expect(capa.children).toHaveLength(2)
    expect(within(banner).queryByTestId('banner-circulo')).not.toBeInTheDocument()
    expect(getComputedStyle(screen.getByRole('heading', { name: CONTENIDO.titulo })).textTransform).toBe('uppercase')
    expect(getComputedStyle(screen.getByRole('link', { name: CONTENIDO.texto_boton })).textTransform).toBe('uppercase')
    expect(reglas()).toMatch(/@media \(min-width:900px\)\{[^}]*font-size:72px/)
  })
  it('sin mayúsculas: el título y el botón van como se escribieron (la franja sigue oscura)', () => {
    montar({ ...MJC, titulosMayusculas: false }, <BannerContenido contenido={CONTENIDO} />)
    expect(getComputedStyle(screen.getByRole('heading', { name: CONTENIDO.titulo })).textTransform).toBe('none')
    expect(getComputedStyle(screen.getByRole('link', { name: CONTENIDO.texto_boton })).textTransform).toBe('none')
    expect(screen.getByTestId('banner-home')).toHaveAttribute('data-estilo', 'oscuro')
  })
})

describe('héroe: variante clara (SJ_Home / SJ_M_Home)', () => {
  const claro = { ...SJ, estiloHeroe: 'claro' as const, titulosMayusculas: false }
  it('franja con la superficie, texto en el primario, título de 60 px (36 px en celular) sin mayúsculas y círculo de 360 px del acento', () => {
    montar(claro, <BannerContenido contenido={CONTENIDO} />)
    const t = crearTemaTienda(claro).tienda!
    const banner = screen.getByTestId('banner-home')
    expect(banner).toHaveAttribute('data-estilo', 'claro')
    const capa = within(banner).getByTestId('banner-capa')
    expect(getComputedStyle(capa).backgroundColor).toBe(hexARgb(t.superficie))
    expect(getComputedStyle(banner).color).toBe('rgb(27, 58, 92)')
    const circulo = within(capa).getByTestId('banner-circulo')
    expect(getComputedStyle(circulo)).toMatchObject({ width: '360px', height: '360px', right: '120px', top: '40px', borderRadius: '50%', opacity: '0.9' })
    expect(getComputedStyle(circulo).backgroundColor).toBe('rgb(233, 162, 59)')
    // Sin franjas inclinadas: la capa solo trae el círculo.
    expect(capa.children).toHaveLength(1)
    const titulo = screen.getByRole('heading', { name: CONTENIDO.titulo })
    expect(getComputedStyle(titulo).textTransform).toBe('none')
    const css = reglas()
    expect(css).toMatch(/@media \(min-width:900px\)\{[^}]*font-size:60px/)
    expect(css).toMatch(/font-size:36px/)
    // El círculo se muestra desde 1200 px: debajo pasaría por detrás del texto.
    expect(css).toMatch(/@media \(min-width:1200px\)\{[^}]*display:block/)
  })
  it('el botón usa el acento con el texto de la tinta (como el del prototipo) y es visible', () => {
    montar(claro, <BannerContenido contenido={CONTENIDO} />)
    const boton = screen.getByRole('link', { name: CONTENIDO.texto_boton })
    expect(getComputedStyle(boton).backgroundColor).toBe('rgb(233, 162, 59)')
    expect(getComputedStyle(boton).color).toBe('rgb(27, 36, 48)')
    expect(getComputedStyle(boton).textTransform).toBe('none')
  })
  it('en la tienda real (la identidad no trae colorTexto) el texto del botón sobre el acento es el #1A1A1A por defecto del tema', () => {
    montar({ colorPrimario: SJ.colorPrimario, colorPrimarioOscuro: SJ.colorPrimarioOscuro, colorAcento: SJ.colorAcento, colorBarra: SJ.colorBarra, colorFondo: SJ.colorFondo, estiloHeroe: 'claro' }, <BannerContenido contenido={CONTENIDO} />)
    expect(getComputedStyle(screen.getByRole('link', { name: CONTENIDO.texto_boton })).color).toBe('rgb(26, 26, 26)')
  })
  it('con mayúsculas activas la variante clara también las aplica (son campos independientes)', () => {
    montar({ ...claro, titulosMayusculas: true }, <BannerContenido contenido={CONTENIDO} />)
    expect(getComputedStyle(screen.getByRole('heading', { name: CONTENIDO.titulo })).textTransform).toBe('uppercase')
  })
  it('un acento igual a la superficie no deja el botón invisible: toma el color del texto de la franja', () => {
    const identidad = { ...claro, colorAcento: '#F0EDE8' }
    montar(identidad, <BannerContenido contenido={CONTENIDO} />)
    const t = crearTemaTienda(identidad).tienda!
    expect(contraste(t.botonDestacado.fondo, t.heroe.fondo)).toBeGreaterThanOrEqual(UMBRAL_BOTON)
    expect(getComputedStyle(screen.getByRole('link', { name: CONTENIDO.texto_boton })).backgroundColor).toBe(hexARgb(t.heroe.texto))
  })
  it('en la vista previa del panel no hay capa ni círculo, pero sí los colores de la variante', () => {
    montar(claro, <BannerContenido vistaPrevia contenido={CONTENIDO} />)
    expect(screen.queryByTestId('banner-capa')).not.toBeInTheDocument()
    expect(screen.queryByTestId('banner-circulo')).not.toBeInTheDocument()
    expect(getComputedStyle(screen.getByTestId('banner-home')).backgroundColor).toBe(hexARgb(crearTemaTienda(claro).tienda!.superficie))
  })
  it.each([320, 768, 1440])('sin violaciones de axe a %i px (variante clara y oscura)', async (ancho) => {
    celular(ancho < 900)
    window.innerWidth = ancho
    for (const identidad of [claro, { ...MJC, estiloHeroe: 'oscuro' as const }]) {
      const { container, unmount } = montar(identidad, <main><BannerContenido contenido={CONTENIDO} /></main>)
      expect(await violacionesAxe(container)).toEqual([])
      unmount()
    }
  })
})

describe('barra de categorías: mayúsculas por identidad (MJC_Home sí, SJ_Home no)', () => {
  const estilo = (nombre: string) => getComputedStyle(screen.getByRole('link', { name: nombre }))
  it('por defecto (sin el campo) va en mayúsculas con el espaciado de .04em', () => {
    montar(MJC, <MenuCategorias categorias={CATEGORIAS} />)
    expect(estilo('Cargadores').textTransform).toBe('uppercase')
    expect(estilo('Cargadores').letterSpacing).toBe('0.6px') // .04em de 15 px, resuelto por jsdom
  })
  it('sin mayúsculas: el texto va como se escribió y sin el espaciado asociado', () => {
    montar({ ...SJ, titulosMayusculas: false }, <MenuCategorias categorias={CATEGORIAS} />)
    expect(estilo('Cargadores').textTransform).toBe('none')
    expect(estilo('Cargadores').letterSpacing).toBe('normal')
    expect(estilo('Joysticks').textTransform).toBe('none')
  })
  it('sin tema de tienda (panel) conserva las mayúsculas de siempre', () => {
    render(<MemoryRouter><MenuCategorias categorias={CATEGORIAS} /></MemoryRouter>)
    expect(estilo('Cargadores').textTransform).toBe('uppercase')
  })
})

// jsdom devuelve los colores como rgb(): conversión para comparar contra los valores del tema.
function hexARgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
