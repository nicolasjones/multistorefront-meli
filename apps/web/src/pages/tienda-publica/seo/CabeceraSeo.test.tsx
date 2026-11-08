import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({ rpc: mocks.rpc }),
    storage: { from: () => ({ getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://cdn.test/${ruta}` } }) }) },
  },
}))

import { limpiarCacheSeo, recortar, rutaCanonica } from '../../../lib/tiendaSeo'
import { CabeceraSeo } from './CabeceraSeo'
import { reiniciarPilaCabecera } from './pilaCabecera'
import { organizacionJsonLd } from './datosEstructurados'

const SEO = { dominio: 'mundojc.test', nombre: 'Mundo JC', descripcion: 'Joysticks y repuestos', logo_ruta: 'o/e/logo.png', indexable: true }

const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute('content') ?? null
const canonica = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null

beforeEach(() => {
  vi.clearAllMocks()
  limpiarCacheSeo()
  reiniciarPilaCabecera()
  document.title = 'web'
  mocks.rpc.mockResolvedValue({ data: SEO, error: null })
})

// F-TDA-21 (FR-021, FR-024, SC-008): metadatos por página, canónica, Open Graph y noindex.
describe('CabeceraSeo · página indexable', () => {
  it('escribe título, descripción, canónica sin filtros, Open Graph y robots', async () => {
    render(<CabeceraSeo host="mundojc.test:443" pagina="Todos los productos" ruta="/catalogo?categoria=1&orden=precio" />)
    await waitFor(() => expect(document.title).toBe('Todos los productos | Mundo JC'))
    expect(mocks.rpc).toHaveBeenCalledWith('seo_tienda_por_dominio', { host: 'mundojc.test:443' })
    expect(meta('meta[name="description"]')).toBe('Joysticks y repuestos')
    expect(canonica()).toBe('https://mundojc.test/catalogo')
    expect(meta('meta[property="og:title"]')).toBe('Todos los productos | Mundo JC')
    expect(meta('meta[property="og:description"]')).toBe('Joysticks y repuestos')
    expect(meta('meta[property="og:type"]')).toBe('website')
    expect(meta('meta[property="og:url"]')).toBe('https://mundojc.test/catalogo')
    expect(meta('meta[property="og:image"]')).toBe('https://cdn.test/o/e/logo.png')
    expect(meta('meta[name="robots"]')).toBe('index, follow')
  })

  it('la ficha usa su descripción, su imagen y el tipo product; título y descripción se recortan', async () => {
    render(<CabeceraSeo host="mundojc.test" pagina={'P'.repeat(80)} descripcion={'d '.repeat(200)} imagen="https://img.test/p.png" ruta="/producto/abc" tipo="product" />)
    await waitFor(() => expect(canonica()).toBe('https://mundojc.test/producto/abc'))
    expect(document.title.length).toBeLessThanOrEqual(60)
    expect(document.title.endsWith('…')).toBe(true)
    expect((meta('meta[name="description"]') ?? '').length).toBeLessThanOrEqual(160)
    expect(meta('meta[property="og:image"]')).toBe('https://img.test/p.png')
    expect(meta('meta[property="og:type"]')).toBe('product')
  })

  it('escribe el JSON-LD con `<` escapado', async () => {
    render(<CabeceraSeo host="mundojc.test" ruta="/" datosEstructurados={({ seo, url }) => [organizacionJsonLd({ nombre: `${seo.nombre}</script>`, url })]} />)
    await waitFor(() => expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull())
    const texto = document.head.querySelector('script[type="application/ld+json"]')!.textContent!
    expect(texto).not.toContain('<')
    expect(JSON.parse(texto)['@type']).toBe('Organization')
  })

  it('al salir de la página limpia lo que escribió y restaura el título', async () => {
    const { unmount } = render(<CabeceraSeo host="mundojc.test" pagina="Contacto" ruta="/contacto" />)
    await waitFor(() => expect(document.title).toBe('Contacto | Mundo JC'))
    unmount()
    expect(document.title).toBe('web')
    expect(document.head.querySelectorAll('[data-tienda-seo]')).toHaveLength(0)
  })

  it('host que no es una tienda: no escribe nada', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    render(<CabeceraSeo host="otro.test" pagina="Contacto" ruta="/contacto" />)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    expect(document.head.querySelectorAll('[data-tienda-seo]')).toHaveLength(0)
    expect(document.title).toBe('web')
  })

  it('con `indexable={false}` (extensión de MSF-133) escribe noindex y no el JSON-LD', async () => {
    render(<CabeceraSeo host="mundojc.test" pagina="Inicio" indexable={false} datosEstructurados={() => [{ a: 1 }]} />)
    await waitFor(() => expect(meta('meta[name="robots"]')).toBe('noindex'))
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('si la base marca la tienda como no indexable, la página lleva noindex', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...SEO, indexable: false }, error: null })
    render(<CabeceraSeo host="mundojc.test" pagina="Contacto" ruta="/contacto" datosEstructurados={() => [{ a: 1 }]} />)
    await waitFor(() => expect(meta('meta[name="robots"]')).toBe('noindex'))
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull()
  })
})

describe('CabeceraSeo · noindex (FR-024)', () => {
  it('escribe solo robots noindex y el título, sin leer la base ni canónica', () => {
    const { unmount } = render(<CabeceraSeo noindex pagina="Volvemos pronto" />)
    expect(meta('meta[name="robots"]')).toBe('noindex')
    expect(document.title).toBe('Volvemos pronto')
    expect(canonica()).toBeNull()
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
    expect(document.title).toBe('web')
  })
})

describe('recortar y rutaCanonica', () => {
  it('recorta con «…» sin pasar el máximo y junta espacios', () => {
    expect(recortar('hola   mundo', 20)).toBe('hola mundo')
    expect(recortar('a'.repeat(30), 10)).toHaveLength(10)
  })

  it('la canónica no lleva query, ancla ni barra final', () => {
    expect(rutaCanonica('/categoria/1/?x=2#a')).toBe('/categoria/1')
    expect(rutaCanonica('/')).toBe('/')
    expect(rutaCanonica('/?q=1')).toBe('/')
  })
})

// MSF-149: una `CabeceraSeo` indexable (la página) y una `noindex` (el error del listado) montadas a la vez.
describe('CabeceraSeo · anidada (padre indexable + hijo noindex)', () => {
  const robots = () => document.head.querySelectorAll('meta[name="robots"]')

  it('queda UNA sola meta robots (noindex) y el título del error, sin importar quién monta primero', async () => {
    const { rerender, unmount } = render(
      <>
        <CabeceraSeo host="mundojc.test" pagina="Todos los productos" ruta="/catalogo" />
        <CabeceraSeo noindex pagina="No pudimos cargar los productos" />
      </>,
    )
    // El hijo `noindex` monta antes de que lleguen los datos del padre; luego el padre completa su cabecera.
    await waitFor(() => expect(canonica()).toBe('https://mundojc.test/catalogo'))
    expect(robots()).toHaveLength(1)
    expect(meta('meta[name="robots"]')).toBe('noindex')
    expect(document.title).toBe('No pudimos cargar los productos')

    // Al desaparecer el error (reintento correcto) el padre vuelve a ser indexable con su título.
    rerender(<CabeceraSeo host="mundojc.test" pagina="Todos los productos" ruta="/catalogo" />)
    await waitFor(() => expect(meta('meta[name="robots"]')).toBe('index, follow'))
    expect(robots()).toHaveLength(1)
    expect(document.title).toBe('Todos los productos | Mundo JC')

    unmount()
    expect(robots()).toHaveLength(0)
    expect(document.title).toBe('web')
  })

  it('desmontar el hijo antes que el padre restaura bien el título original', async () => {
    const { unmount } = render(
      <>
        <CabeceraSeo noindex pagina="Error" />
        <CabeceraSeo noindex pagina="Otro error" />
      </>,
    )
    expect(robots()).toHaveLength(1)
    expect(document.title).toBe('Otro error')
    unmount()
    expect(document.title).toBe('web')
    expect(robots()).toHaveLength(0)
  })
})
