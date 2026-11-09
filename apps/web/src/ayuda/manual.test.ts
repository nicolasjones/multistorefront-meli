import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { MANUAL_URL_POR_DEFECTO, plantillaManual, plantillaManualValida, urlManual } from './manual'
import { MANUAL_POR_DESTINO, SIN_PAGINA_PROPIA } from './manualPorDestino'

describe('dirección del manual: un solo lugar', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('por defecto apunta a las páginas del sitio de documentación publicado', () => {
    expect(plantillaManual(undefined)).toBe(MANUAL_URL_POR_DEFECTO)
    expect(plantillaManual('')).toBe(MANUAL_URL_POR_DEFECTO)
    expect(plantillaManual('   ')).toBe(MANUAL_URL_POR_DEFECTO)
    expect(urlManual('catalogo-productos')).toBe('https://docs.212-90-120-53.sslip.io/producto/catalogo-productos/')
  })

  it('cambiar la dirección es cambiar la plantilla: todas las páginas la siguen', () => {
    const plantilla = 'https://manual.ejemplo.com/ayuda/{pagina}/'
    expect(plantillaManual(plantilla)).toBe(plantilla)
    expect(urlManual('clientes', plantilla)).toBe('https://manual.ejemplo.com/ayuda/clientes/')
    expect(urlManual('rentabilidad', plantilla)).toBe('https://manual.ejemplo.com/ayuda/rentabilidad/')
  })

  it('sin página, o con una página vacía, abre el índice: la carpeta del manual, sin configurar nada más', () => {
    expect(urlManual()).toBe('https://docs.212-90-120-53.sslip.io/producto/')
    expect(urlManual(null)).toBe('https://docs.212-90-120-53.sslip.io/producto/')
    expect(urlManual('  ')).toBe('https://docs.212-90-120-53.sslip.io/producto/')
    expect(urlManual(undefined, 'https://manual.ejemplo.com/ayuda/{pagina}/')).toBe('https://manual.ejemplo.com/ayuda/')
    expect(urlManual(undefined, 'https://github.com/o/r/blob/main/docs/producto/{pagina}.md')).toBe('https://github.com/o/r/blob/main/docs/producto/')
  })

  it('una plantilla inválida se descarta y se avisa: solo http(s) y con {pagina}', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const mala of ['javascript:alert(1)//{pagina}', 'https://sin-marca.ejemplo.com/', 'ftp://x/{pagina}', '/ruta/relativa/{pagina}', 'https://x.ejemplo.com/?p={pagina}', 'https://x.ejemplo.com/#{pagina}']) {
      expect(plantillaManualValida(mala)).toBe(false)
      expect(plantillaManual(mala)).toBe(MANUAL_URL_POR_DEFECTO)
    }
    expect(aviso).toHaveBeenCalledTimes(6)
  })

  it('el nombre de la página se escapa y no puede cambiar el destino del enlace', () => {
    expect(urlManual('a/b?c=d#e', 'https://m.ejemplo.com/{pagina}')).toBe('https://m.ejemplo.com/a%2Fb%3Fc%3Dd%23e')
  })
})

describe('mapa pantalla → página del manual', () => {
  const ids = DESTINOS_PANEL.map((d) => d.id)

  it('ningún destino del mapa sobra: todos existen en el menú', () => {
    expect(Object.keys(MANUAL_POR_DESTINO).filter((id) => !ids.includes(id))).toEqual([])
    expect(SIN_PAGINA_PROPIA.filter((id) => !ids.includes(id))).toEqual([])
  })

  it('todo destino del menú tiene página o está declarado sin página propia (y no ambas cosas)', () => {
    expect(ids.filter((id) => !(id in MANUAL_POR_DESTINO) && !SIN_PAGINA_PROPIA.includes(id))).toEqual([])
    expect(SIN_PAGINA_PROPIA.filter((id) => id in MANUAL_POR_DESTINO)).toEqual([])
  })

  it('el mapa lleva nombres de página, nunca direcciones', () => {
    for (const [id, pagina] of Object.entries(MANUAL_POR_DESTINO)) {
      expect(pagina, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})
