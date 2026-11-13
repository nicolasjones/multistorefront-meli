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

import { useTheme } from '@mui/material'
import { ProveedorFuenteTienda, type FuenteTienda } from '../../lib/fuenteTienda'
import { ProveedorIdentidadTienda } from './layout/IdentidadTiendaContexto'
import TemaTienda, { orden } from './secciones/TemaTienda'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }

const MUNDO_JC: IdentidadTienda = {
  colorPrimario: '#C8102E',
  colorPrimarioOscuro: '#7A0A12',
  colorAcento: '#C8102E',
  colorFondo: '#FFFFFF',
  colorBarra: '#222222',
  tipografiaTitulos: 'Barlow Condensed',
  tipografiaTexto: 'Barlow',
  logoRuta: 'org-1/e-1/logo.png',
  bannerRuta: 'org-1/e-1/banner.webp',
  bannerMovilRuta: 'org-1/e-1/banner-movil.webp',
}
const SAN_JAVUCHO: IdentidadTienda = { ...IDENTIDAD_BASE, colorPrimario: '#2E6B3F', colorFondo: '#FAF7F0', tipografiaTitulos: 'Playfair Display', tipografiaTexto: 'Lato' }

const variable = (nombre: string) => document.documentElement.style.getPropertyValue(nombre)

// El layout aplica la identidad (variables, fuentes y tema); la sección de la portada solo muestra el banner.
function Sonda() {
  const t = useTheme()
  return <span data-testid="sonda">{`${t.palette.primary.main}|${t.palette.primary.dark}|${t.tienda?.barra}|${t.typography.h1.fontFamily}`}</span>
}
function montar(tiendaPublica: typeof tienda, host: string) {
  return render(<ProveedorIdentidadTienda host={host}><Sonda /><TemaTienda tienda={tiendaPublica} host={host} /></ProveedorIdentidadTienda>)
}

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
    montar(tienda, "mundojc.com.ar")
    await screen.findByTestId('tema-tienda')
    expect(mocks.resolver).toHaveBeenCalledWith('mundojc.com.ar')
  })

  it('aplica colores y tipografías como variables de tema y carga las fuentes', async () => {
    mocks.resolver.mockResolvedValue(MUNDO_JC)
    montar(tienda, "mundojc.com.ar")
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#C8102E'))
    expect(variable('--tienda-color-primario-oscuro')).toBe('#7A0A12')
    expect(variable('--tienda-color-acento')).toBe('#C8102E')
    expect(variable('--tienda-color-fondo')).toBe('#FFFFFF')
    expect(variable('--tienda-fuente-titulos')).toBe('"Barlow Condensed", system-ui, sans-serif')
    expect(variable('--tienda-fuente-texto')).toBe('"Barlow", system-ui, sans-serif')
    const enlace = document.head.querySelector('link[rel="stylesheet"][data-tienda-fuentes]')
    expect(enlace?.getAttribute('href')).toContain('family=Barlow+Condensed')
    expect(enlace?.getAttribute('href')).toContain('family=Barlow:')
  })

  it('muestra el banner con su variante móvil y no dibuja el logo (va en el encabezado y el pie)', async () => {
    mocks.resolver.mockResolvedValue(MUNDO_JC)
    const { container } = montar(tienda, 'mundojc.com.ar')
    await waitFor(() => expect(container.querySelector('picture img')).toHaveAttribute('src', 'https://cdn.test/org-1/e-1/banner.webp'))
    expect(container.querySelector('picture source')).toHaveAttribute('srcset', 'https://cdn.test/org-1/e-1/banner-movil.webp')
    expect(screen.queryByRole('img', { name: 'Logo de Mundo JC' })).not.toBeInTheDocument()
  })

  it('aplica la identidad al tema MUI y expone el color de la barra, para toda la tienda y no solo la portada', async () => {
    mocks.resolver.mockResolvedValue({ ...MUNDO_JC, colorBarra: '#2A2A2A' })
    montar(tienda, 'mundojc.com.ar')
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toContain('#C8102E|#7A0A12|#2A2A2A|"Barlow Condensed"'))
    expect(variable('--tienda-color-barra')).toBe('#2A2A2A')
  })

  it('en la vista previa del panel (identidad inyectada) muestra el logo y no toca variables globales ni la red', async () => {
    const fuente = { identidad: MUNDO_JC } as unknown as FuenteTienda
    render(<ProveedorFuenteTienda value={fuente}><TemaTienda tienda={tienda} host="vista-previa" /></ProveedorFuenteTienda>)
    expect(await screen.findByRole('img', { name: 'Logo de Mundo JC' })).toHaveAttribute('src', 'https://cdn.test/org-1/e-1/logo.png')
    expect(mocks.resolver).not.toHaveBeenCalled()
    expect(variable('--tienda-color-primario')).toBe('')
  })

  it('sin logo ni banners no muestra imágenes y usa el tema base (sin cargar fuentes)', async () => {
    mocks.resolver.mockResolvedValue(IDENTIDAD_BASE)
    montar(tienda, "mundojc.com.ar")
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#222222'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.head.querySelector('link[rel="stylesheet"][data-tienda-fuentes]')).toBeNull()
  })

  it('dos tiendas no mezclan estilos: cada host aplica solo su propia identidad', async () => {
    mocks.resolver.mockImplementation(async (host: string) => (host === 'mundojc.com.ar' ? MUNDO_JC : SAN_JAVUCHO))
    const primera = montar(tienda, "mundojc.com.ar")
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#C8102E'))
    primera.unmount()
    expect(variable('--tienda-color-primario')).toBe('')

    montar({ ...tienda, empresaNombre: 'San Javucho' }, "sanjavucho.com.ar")
    await waitFor(() => expect(variable('--tienda-color-primario')).toBe('#2E6B3F'))
    expect(variable('--tienda-color-fondo')).toBe('#FAF7F0')
    expect(variable('--tienda-fuente-titulos')).toContain('Playfair Display')
    expect(document.body.style.backgroundColor).toBe('rgb(250, 247, 240)')
  })

  it('dominio sin identidad (sin filas) no aplica nada ni muestra nada', async () => {
    mocks.resolver.mockResolvedValue(null)
    montar(tienda, "desconocido.com")
    await waitFor(() => expect(mocks.resolver).toHaveBeenCalled())
    expect(screen.queryByTestId('tema-tienda')).not.toBeInTheDocument()
    expect(variable('--tienda-color-primario')).toBe('')
  })

  it('si la identidad no se puede leer la tienda sigue sin romperse', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.resolver.mockRejectedValue(new Error('sin red'))
    montar(tienda, "mundojc.com.ar")
    await waitFor(() => expect(consola).toHaveBeenCalled())
    expect(screen.queryByTestId('tema-tienda')).not.toBeInTheDocument()
    expect(screen.getByTestId('sonda').textContent).toContain('#222222')
    consola.mockRestore()
  })
})
