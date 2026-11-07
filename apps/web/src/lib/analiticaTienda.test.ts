import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import {
  cargarMedicion,
  debeMedir,
  hayMedicionCargada,
  leerAnaliticaPublica,
  registrarEventoTienda,
  registrarVisita,
  reiniciarMedicionParaPruebas,
  URL_GTAG,
  URL_PIXEL,
} from './analiticaTienda'

const scripts = () => Array.from(document.head.querySelectorAll('script')).map((s) => s.getAttribute('src'))
const IDS = { ga4_id: 'G-ABC123', meta_pixel_id: '123456789' }

describe('analiticaTienda (F-TDA-24, FR-012, FR-014…FR-016)', () => {
  beforeEach(() => {
    reiniciarMedicionParaPruebas()
    mocks.rpc.mockReset()
  })
  afterEach(() => reiniciarMedicionParaPruebas())

  describe('debeMedir: cada condición por separado (FR-014)', () => {
    it('mide con al menos un ID y consentimiento aceptado', () => {
      expect(debeMedir(IDS, 'aceptadas')).toBe(true)
      expect(debeMedir({ ga4_id: 'G-ABC123', meta_pixel_id: null }, 'aceptadas')).toBe(true)
      expect(debeMedir({ ga4_id: null, meta_pixel_id: '123456789' }, 'aceptadas')).toBe(true)
    })
    it('no mide sin consentimiento, con cookies rechazadas ni sin decisión', () => {
      expect(debeMedir(IDS, null)).toBe(false)
      expect(debeMedir(IDS, 'rechazadas')).toBe(false)
    })
    it('no mide sin IDs (empresa sin analítica) ni sin datos (tienda desconocida o desactivada)', () => {
      expect(debeMedir({ ga4_id: null, meta_pixel_id: null }, 'aceptadas')).toBe(false)
      expect(debeMedir(null, 'aceptadas')).toBe(false)
    })
  })

  describe('leerAnaliticaPublica (FR-012)', () => {
    it('consulta publico.analitica_por_dominio con el host y devuelve solo los dos IDs', async () => {
      mocks.rpc.mockResolvedValue({ data: IDS, error: null })
      await expect(leerAnaliticaPublica('www.mundojc.com.ar')).resolves.toEqual(IDS)
      expect(mocks.rpc).toHaveBeenCalledWith('analitica_por_dominio', { host: 'www.mundojc.com.ar' })
    })
    it('devuelve null para una tienda desconocida o desactivada', async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: null })
      await expect(leerAnaliticaPublica('x.com')).resolves.toBeNull()
    })
    it('una falla de red o de la base se traga: sin IDs y sin romper la tienda', async () => {
      mocks.rpc.mockRejectedValue(new Error('sin red'))
      await expect(leerAnaliticaPublica('x.com')).resolves.toBeNull()
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
      await expect(leerAnaliticaPublica('x.com')).resolves.toBeNull()
    })
  })

  describe('cargarMedicion (FR-014)', () => {
    it('sin llamar a cargarMedicion no se descarga ningún script', () => {
      expect(scripts()).toEqual([])
      expect(hayMedicionCargada()).toBe(false)
    })
    it('carga los scripts oficiales de Google y de Meta con sus IDs', () => {
      cargarMedicion(IDS)
      expect(scripts()).toEqual([`${URL_GTAG}?id=G-ABC123`, URL_PIXEL])
      expect(hayMedicionCargada()).toBe(true)
    })
    it('carga solo la herramienta que la empresa configuró', () => {
      cargarMedicion({ ga4_id: null, meta_pixel_id: '123456789' })
      expect(scripts()).toEqual([URL_PIXEL])
    })
    it('es idempotente: una segunda llamada no duplica scripts', () => {
      cargarMedicion(IDS)
      cargarMedicion(IDS)
      expect(scripts()).toHaveLength(2)
    })
    it('los IDs se pasan como datos: el de GA4 va codificado en la URL y nunca se arma código con él', () => {
      cargarMedicion({ ga4_id: 'G-A"><script>alert(1)</script>', meta_pixel_id: null })
      const src = scripts()[0] ?? ''
      expect(src.startsWith(`${URL_GTAG}?id=`)).toBe(true)
      expect(src).not.toContain('<script>')
      expect(document.head.querySelectorAll('script')).toHaveLength(1)
      const capa = (window as unknown as { dataLayer: unknown[] }).dataLayer
      expect(JSON.stringify(Array.from(capa[1] as ArrayLike<unknown>))).toContain('G-A')
    })
    it('una falla al crear el script no rompe la tienda', () => {
      const espia = vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('bloqueado') })
      try {
        expect(() => cargarMedicion(IDS)).not.toThrow()
      } finally {
        espia.mockRestore()
      }
    })
  })

  describe('visitas y eventos (FR-015, FR-016)', () => {
    it('sin medición cargada no hacen nada ni lanzan', () => {
      expect(() => registrarVisita('/producto/1')).not.toThrow()
      expect(() => registrarEventoTienda('clic_whatsapp')).not.toThrow()
      expect((window as unknown as { dataLayer?: unknown[] }).dataLayer).toBeUndefined()
    })
    it('registran la visita en las dos herramientas con la ruta, sin datos personales', () => {
      cargarMedicion(IDS)
      const fbq = vi.fn()
      ;(window as unknown as { fbq: unknown }).fbq = fbq
      registrarVisita('/producto/42')
      const capa = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((x) => Array.from(x))
      expect(capa).toContainEqual(['event', 'page_view', { page_path: '/producto/42' }])
      expect(fbq).toHaveBeenCalledWith('track', 'PageView')
    })
    it('emiten solo el nombre del evento', () => {
      cargarMedicion(IDS)
      const fbq = vi.fn()
      ;(window as unknown as { fbq: unknown }).fbq = fbq
      registrarEventoTienda('envio_contacto')
      const capa = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((x) => Array.from(x))
      expect(capa).toContainEqual(['event', 'envio_contacto'])
      expect(fbq).toHaveBeenCalledWith('trackCustom', 'envio_contacto')
    })
    it('una falla de la herramienta no rompe la tienda', () => {
      cargarMedicion(IDS)
      ;(window as unknown as { gtag: unknown }).gtag = () => { throw new Error('boom') }
      expect(() => registrarEventoTienda('clic_whatsapp')).not.toThrow()
      expect(() => registrarVisita('/')).not.toThrow()
    })
  })
})
