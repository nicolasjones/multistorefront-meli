import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { guardarConsentimiento, reiniciarConsentimientoEnMemoria } from './consentimientoCookies'
import {
  cargarMedicion,
  debeMedir,
  hayMedicionCargada,
  retirarMedicion,
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
    window.localStorage.clear()
    reiniciarConsentimientoEnMemoria()
    guardarConsentimiento('aceptadas')
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
    it('revalida los formatos del CHECK de la base: un ID inválido se descarta', async () => {
      mocks.rpc.mockResolvedValue({ data: { ga4_id: 'G-A"><x', meta_pixel_id: 'abc' }, error: null })
      await expect(leerAnaliticaPublica('x.com')).resolves.toEqual({ ga4_id: null, meta_pixel_id: null })
      mocks.rpc.mockResolvedValue({ data: { ga4_id: 'G-ABC123', meta_pixel_id: 123456789 }, error: null })
      await expect(leerAnaliticaPublica('x.com')).resolves.toEqual({ ga4_id: 'G-ABC123', meta_pixel_id: null })
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
    it('los IDs se pasan como datos: un ID con código se descarta y uno válido va codificado en la URL', () => {
      cargarMedicion({ ga4_id: 'G-A"><script>alert(1)</script>', meta_pixel_id: null })
      expect(scripts()).toEqual([])
      expect(document.head.querySelectorAll('script')).toHaveLength(0)
      cargarMedicion({ ga4_id: 'G-ABC123', meta_pixel_id: null })
      expect(scripts()).toEqual([`${URL_GTAG}?id=G-ABC123`])
      const capa = (window as unknown as { dataLayer: unknown[] }).dataLayer
      expect(JSON.stringify(Array.from(capa[1] as ArrayLike<unknown>))).toContain('G-ABC123')
    })
    it('sin consentimiento aceptado en ese instante no carga nada', () => {
      guardarConsentimiento('rechazadas')
      cargarMedicion(IDS)
      expect(scripts()).toEqual([])
      expect(hayMedicionCargada()).toBe(false)
    })
    it('descarta IDs con formato inválido: nunca llegan a una URL ni a gtag/fbq', () => {
      cargarMedicion({ ga4_id: 'g-minuscula', meta_pixel_id: '12ab' })
      expect(scripts()).toEqual([])
      expect(hayMedicionCargada()).toBe(false)
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
      expect(fbq).toHaveBeenCalledWith('trackSingle', '123456789', 'PageView')
    })
    it('emiten solo el nombre del evento', () => {
      cargarMedicion(IDS)
      const fbq = vi.fn()
      ;(window as unknown as { fbq: unknown }).fbq = fbq
      registrarEventoTienda('envio_contacto')
      const capa = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((x) => Array.from(x))
      expect(capa).toContainEqual(['event', 'envio_contacto'])
      expect(fbq).toHaveBeenCalledWith('trackSingleCustom', '123456789', 'envio_contacto')
    })
    it('una falla de la herramienta no rompe la tienda', () => {
      cargarMedicion(IDS)
      ;(window as unknown as { gtag: unknown }).gtag = () => { throw new Error('boom') }
      expect(() => registrarEventoTienda('clic_whatsapp')).not.toThrow()
      expect(() => registrarVisita('/')).not.toThrow()
    })
  })

  describe('consentimiento vigente y cambio de IDs', () => {
    const capa = () => (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((x) => Array.from(x))
    const conPixel = () => {
      const fbq = vi.fn()
      ;(window as unknown as { fbq: unknown }).fbq = fbq
      return fbq
    }

    it('acepta y luego revoca: los eventos y visitas dejan de enviarse y la medición se apaga', () => {
      cargarMedicion(IDS)
      const fbq = conPixel()
      registrarEventoTienda('clic_whatsapp')
      expect(capa()).toContainEqual(['event', 'clic_whatsapp'])

      guardarConsentimiento('rechazadas')
      registrarEventoTienda('envio_contacto')
      registrarEventoTienda('vista_producto')
      registrarVisita('/x')

      expect(capa().filter((e) => e[1] === 'envio_contacto' || e[1] === 'vista_producto' || e[1] === 'page_view')).toEqual([])
      expect(fbq).not.toHaveBeenCalledWith('trackSingleCustom', expect.anything(), 'envio_contacto')
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      expect(capa()).toContainEqual(['consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' }])
      expect(fbq).toHaveBeenCalledWith('consent', 'revoke')
      expect(hayMedicionCargada()).toBe(false)
    })
    it('si vuelve a aceptar se reactiva sin duplicar scripts', () => {
      cargarMedicion(IDS)
      conPixel()
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      guardarConsentimiento('aceptadas')
      cargarMedicion(IDS)
      expect(scripts()).toHaveLength(2)
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBeUndefined()
      registrarEventoTienda('busqueda')
      expect(capa()).toContainEqual(['event', 'busqueda'])
    })
    it('un ID nuevo reemplaza al anterior: el viejo queda desactivado y los eventos van solo al nuevo', () => {
      cargarMedicion(IDS)
      const fbq = conPixel()
      cargarMedicion({ ga4_id: 'G-NUEVO99', meta_pixel_id: '987654321' })
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      expect(capa()).toContainEqual(['config', 'G-NUEVO99', { send_page_view: false }])
      registrarEventoTienda('vista_producto')
      expect(fbq).toHaveBeenCalledWith('init', '987654321')
      expect(fbq).toHaveBeenCalledWith('trackSingleCustom', '987654321', 'vista_producto')
      expect(fbq).not.toHaveBeenCalledWith('trackSingleCustom', '123456789', 'vista_producto')
    })
    it('un evento que llega antes de cargar la medición espera y se emite al cargarla (sin datos extra)', () => {
      registrarEventoTienda('vista_producto')
      expect((window as unknown as { dataLayer?: unknown[] }).dataLayer).toBeUndefined()
      cargarMedicion({ ga4_id: 'G-ABC123', meta_pixel_id: null })
      expect(capa()).toContainEqual(['event', 'vista_producto'])
    })
  })
})
