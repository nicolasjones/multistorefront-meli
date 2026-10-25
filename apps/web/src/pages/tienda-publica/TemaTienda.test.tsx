import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTIDAD_BASE, type IdentidadTienda } from '../../lib/tiendaIdentidad'

const mocks = vi.hoisted(() => ({ resolver: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/tiendaIdentidad', async (original) => ({
  ...(await original<typeof import('../../lib/tiendaIdentidad')>()),
  resolverIdentidadPublica: mocks.resolver,
  urlPublica: (ruta: string | null) => (ruta ? `https://cdn.test/${ruta}` : null),
}))

import TemaTienda, { orden } from './secciones/TemaTienda'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }

const MUNDO_JC: IdentidadTienda = {
  colorPrimario: '#C8102E',
  colorPrimarioOscuro: '#7A0A12',
  colorAcento: '#C8102E',
  colorFondo: '#FFFFFF',
  tipografiaTitulos: 'Barlow Condensed',
  tipografiaTexto: 'Barlow',
  logoRuta: 'org-1/e-1/logo.png',
  bannerRuta: 'org-1/e-1/banner.webp',
  bannerMovilRuta: 'org-1/e-1/banner-movil.webp',
}
const SAN_JAVUCHO: IdentidadTienda = { ...IDENTIDAD_BASE, colorPrimario: '#2E6B3F', colorFondo: '#FAF7F0', tipografiaTitulos: 'Playfair Display', tipografiaTexto: 'Lato' }

const variable = (nombre: string) => document.documentElement.style.getPropertyValue(nombre)

beforeEach(() => {
  vi.clearAllMocks()
  document.head.querySelectorAll('link[data-tienda-fuentes]').forEach((enlace) => enlace.remove())
})

describe('TemaTienda (FR-030)', () => {
  it('se ordena antes que las secciones de contenido y catálogo', () => {
    expect(orden).toBeLessThan(100)
  })

  it('consulta la identidad por el host de la petición', async () => {
    mocks.resolver.mockResolvedValue(MUNDO_JC)
    render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    await screen.findByTestId('tema-tienda')
    expect(mocks.resolver).toHaveBeenCalledWith('mundojc.com.ar')
  })

  it('aplica colores y tipografías como variables de tema y carga las fuentes', async () => {
    mocks.resolver.mockResolvedValue(MUNDO_JC)
    render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#C8102E'))
    expect(variable('--tienda-color-primario-oscuro')).toBe('#7A0A12')
    expect(variable('--tienda-color-acento')).toBe('#C8102E')
    expect(variable('--tienda-color-fondo')).toBe('#FFFFFF')
    expect(variable('--tienda-fuente-titulos')).toBe('"Barlow Condensed", system-ui, sans-serif')
    expect(variable('--tienda-fuente-texto')).toBe('"Barlow", system-ui, sans-serif')
    const enlace = document.head.querySelector('link[data-tienda-fuentes]')
    expect(enlace?.getAttribute('href')).toContain('family=Barlow+Condensed')
    expect(enlace?.getAttribute('href')).toContain('family=Barlow:')
  })

  it('muestra el logo de la empresa y el banner con su variante móvil', async () => {
    mocks.resolver.mockResolvedValue(MUNDO_JC)
    const { container } = render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    expect(await screen.findByRole('img', { name: 'Logo de Mundo JC' })).toHaveAttribute('src', 'https://cdn.test/org-1/e-1/logo.png')
    expect(container.querySelector('picture img')).toHaveAttribute('src', 'https://cdn.test/org-1/e-1/banner.webp')
    expect(container.querySelector('picture source')).toHaveAttribute('srcset', 'https://cdn.test/org-1/e-1/banner-movil.webp')
  })

  it('sin logo ni banners no muestra imágenes y usa el tema base (sin cargar fuentes)', async () => {
    mocks.resolver.mockResolvedValue(IDENTIDAD_BASE)
    render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#222222'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.head.querySelector('link[data-tienda-fuentes]')).toBeNull()
  })

  it('dos tiendas no mezclan estilos: cada host aplica solo su propia identidad', async () => {
    mocks.resolver.mockImplementation(async (host: string) => (host === 'mundojc.com.ar' ? MUNDO_JC : SAN_JAVUCHO))
    const primera = render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#C8102E'))
    primera.unmount()
    expect(variable('--tienda-color-primario')).toBe('')

    render(<TemaTienda tienda={{ ...tienda, empresaNombre: 'San Javucho' }} host="sanjavucho.com.ar" />)
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#2E6B3F'))
    expect(variable('--tienda-color-fondo')).toBe('#FAF7F0')
    expect(variable('--tienda-fuente-titulos')).toContain('Playfair Display')
    expect(document.body.style.backgroundColor).toBe('rgb(250, 247, 240)')
  })

  it('dominio sin identidad (sin filas) no aplica nada ni muestra nada', async () => {
    mocks.resolver.mockResolvedValue(null)
    const { container } = render(<TemaTienda tienda={tienda} host="desconocido.com" />)
    await waitFor(() => expect(mocks.resolver).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(variable('--tienda-color-primario')).toBe('')
  })

  it('si la identidad no se puede leer la tienda sigue sin romperse', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.resolver.mockRejectedValue(new Error('sin red'))
    const { container } = render(<TemaTienda tienda={tienda} host="mundojc.com.ar" />)
    await waitFor(() => expect(consola).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    consola.mockRestore()
  })
})
