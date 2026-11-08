import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { guardarConsentimiento, reiniciarConsentimientoEnMemoria } from './consentimientoCookies'
import {
  accionesPagina,
  cargarMedicion,
  dominiosCookie,
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

const recargar = vi.fn()
const scriptCargado = (inicio: string) => {
  const nodo = Array.from(document.head.querySelectorAll('script')).find((s) => s.getAttribute('src')?.startsWith(inicio))
  nodo?.onload?.(new Event('load'))
}
const scriptFallido = (inicio: string) => {
  const nodo = Array.from(document.head.querySelectorAll('script')).find((s) => s.getAttribute('src')?.startsWith(inicio))
  nodo?.onerror?.(new Event('error'))
}
const cookiesActuales = () => document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean)
const borrarTodasLasCookies = () => cookiesActuales().forEach((n) => { document.cookie = `${n}=; max-age=0; path=/` })

describe('analiticaTienda (F-TDA-24, FR-012, FR-014…FR-016)', () => {
  beforeEach(() => {
    reiniciarMedicionParaPruebas()
    recargar.mockReset()
    accionesPagina.recargar = recargar
    borrarTodasLasCookies()
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
      const capaViva = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer

      guardarConsentimiento('rechazadas')
      registrarEventoTienda('envio_contacto')
      registrarEventoTienda('vista_producto')
      registrarVisita('/x')

      const capaFinal = capaViva.map((x) => Array.from(x))
      expect(capaFinal.filter((e) => e[1] === 'envio_contacto' || e[1] === 'vista_producto' || e[1] === 'page_view')).toEqual([])
      expect(fbq).not.toHaveBeenCalledWith('trackSingleCustom', expect.anything(), 'envio_contacto')
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      expect(capaFinal).toContainEqual(['consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' }])
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
      expect(fbq).toHaveBeenCalledWith('init', '987654321', {})
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

  describe('Meta Pixel sin datos del visitante (hallazgo 2)', () => {
    it('apaga la configuración automática ANTES de init y hace init sin opciones de coincidencia avanzada', () => {
      cargarMedicion({ ga4_id: null, meta_pixel_id: '123456789' })
      const cola = (window as unknown as { fbq: { queue: ArrayLike<unknown>[] } }).fbq.queue.map((x) => Array.from(x))
      const iSet = cola.findIndex((c) => c[0] === 'set' && c[1] === 'autoConfig')
      const iInit = cola.findIndex((c) => c[0] === 'init')
      expect(cola[iSet]).toEqual(['set', 'autoConfig', false, '123456789'])
      expect(cola[iInit]).toEqual(['init', '123456789', {}])
      expect(iSet).toBeGreaterThanOrEqual(0)
      expect(iSet).toBeLessThan(iInit)
    })
    it('los eventos propios llevan solo el nombre, sin parámetros del visitante', () => {
      cargarMedicion({ ga4_id: null, meta_pixel_id: '123456789' })
      registrarEventoTienda('envio_contacto')
      const cola = (window as unknown as { fbq: { queue: ArrayLike<unknown>[] } }).fbq.queue.map((x) => Array.from(x))
      expect(cola).toContainEqual(['trackSingleCustom', '123456789', 'envio_contacto'])
    })
  })

  describe('revocar el consentimiento borra las huellas (hallazgo 1)', () => {
    it('borra las cookies de medición de Google y Meta y deja las demás', () => {
      cargarMedicion(IDS)
      document.cookie = '_ga=GA1.1.1; path=/'
      document.cookie = '_ga_ABC123=GS1; path=/'
      document.cookie = '_gid=1; path=/'
      document.cookie = '_gat=1; path=/'
      document.cookie = '_fbp=fb.1; path=/'
      document.cookie = 'carrito=abc; path=/'
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(cookiesActuales()).toEqual(['carrito'])
    })
    it('quita los scripts y las globales de medición para que nada siga emitiendo', () => {
      cargarMedicion(IDS)
      const w = window as unknown as Record<string, unknown>
      w._fbq = {}
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(scripts()).toEqual([])
      for (const clave of ['dataLayer', 'gtag', 'fbq', '_fbq']) expect(w[clave]).toBeUndefined()
      expect(w['ga-disable-G-ABC123']).toBe(true) // el interruptor oficial queda puesto
    })
    it('es idempotente y no recarga si los scripts fallaron (nunca se evaluaron)', () => {
      cargarMedicion(IDS)
      scriptFallido(URL_GTAG)
      scriptFallido(URL_PIXEL)
      retirarMedicion()
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
    })
    it('recarga la página para soltar los scripts evaluados cuando no hay nada que perder', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      retirarMedicion()
      expect(recargar).toHaveBeenCalledTimes(1)
    })
    it('NO recarga con un formulario con texto escrito, y recarga cuando ya no lo hay', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      const campo = document.createElement('input')
      campo.type = 'email'
      document.body.appendChild(campo)
      campo.value = 'ana@example.com'
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
      expect(cookiesActuales()).not.toContain('_ga') // igual quedó apagada y limpia
      campo.value = ''
      retirarMedicion()
      expect(recargar).toHaveBeenCalledTimes(1)
      campo.remove()
    })
    it('NO recarga con un diálogo abierto', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_PIXEL)
      const dialogo = document.createElement('div')
      dialogo.setAttribute('role', 'dialog')
      document.body.appendChild(dialogo)
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
      dialogo.remove()
    })
    it('revocar con texto escrito y volver a aceptar NO carga encima de los scripts viejos: espera y recarga cuando es seguro', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      scriptCargado(URL_PIXEL)
      const campo = document.createElement('textarea')
      document.body.appendChild(campo)
      campo.value = 'texto'
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
      guardarConsentimiento('aceptadas')
      cargarMedicion(IDS)
      // No se inyectó ningún script nuevo ni se borró el interruptor del GA4 viejo.
      expect(scripts()).toEqual([])
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      expect(hayMedicionCargada()).toBe(false)
      expect(recargar).not.toHaveBeenCalled()
      // Cuando suelta el campo (ya vacío), se recarga.
      campo.value = ''
      campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      expect(recargar).toHaveBeenCalledTimes(1)
      campo.remove()
    })
    it('un select cambiado, un contenteditable o el foco en un campo impiden recargar', () => {
      const cargarYRevocar = () => {
        cargarMedicion(IDS)
        scriptCargado(URL_GTAG)
        guardarConsentimiento('rechazadas')
        retirarMedicion()
      }
      const lista = document.createElement('select')
      lista.innerHTML = '<option value="a" selected>A</option><option value="b">B</option>'
      document.body.appendChild(lista)
      lista.value = 'b'
      cargarYRevocar()
      expect(recargar).not.toHaveBeenCalled()
      lista.value = 'a' // vuelve a lo inicial
      reiniciarMedicionParaPruebas()
      accionesPagina.recargar = recargar
      guardarConsentimiento('aceptadas')
      cargarYRevocar()
      expect(recargar).toHaveBeenCalledTimes(1)
      lista.remove()

      recargar.mockReset()
      reiniciarMedicionParaPruebas()
      accionesPagina.recargar = recargar
      guardarConsentimiento('aceptadas')
      const editable = document.createElement('div')
      editable.setAttribute('contenteditable', 'true')
      document.body.appendChild(editable)
      cargarYRevocar()
      expect(recargar).not.toHaveBeenCalled()
      editable.remove()

      reiniciarMedicionParaPruebas()
      accionesPagina.recargar = recargar
      guardarConsentimiento('aceptadas')
      const campo = document.createElement('input')
      document.body.appendChild(campo)
      campo.focus()
      cargarYRevocar()
      expect(recargar).not.toHaveBeenCalled()
      campo.blur()
      campo.remove()
    })
    it('con la pestaña en segundo plano difiere la recarga hasta que vuelve a primer plano', () => {
      const oculto = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
      oculto.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(recargar).toHaveBeenCalledTimes(1)
      oculto.mockRestore()
    })
    it('revocar con un script en vuelo: se trata como en memoria y se recarga; si llega tarde, queda inerte y limpio', () => {
      cargarMedicion(IDS)
      const nodo = Array.from(document.head.querySelectorAll('script')).find((n) => n.getAttribute('src')?.startsWith(URL_GTAG))!
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).toHaveBeenCalledTimes(1)
      // El script, ya sin nodo en el documento, se evalúa igual y deja huellas: se limpian.
      recargar.mockReset()
      document.cookie = '_ga=GA1.1.1; path=/'
      window.localStorage.setItem('_gcl_ls', 'x')
      ;(window as unknown as Record<string, unknown>).dataLayer = []
      ;(window as unknown as Record<string, unknown>).gtag = () => undefined
      ;(window as unknown as Record<string, unknown>).fbq = () => undefined
      nodo.onload?.(new Event('load'))
      expect(cookiesActuales()).not.toContain('_ga')
      expect(window.localStorage.getItem('_gcl_ls')).toBeNull()
      for (const clave of ['dataLayer', 'gtag', 'fbq', '_fbq']) {
        expect((window as unknown as Record<string, unknown>)[clave]).toBeUndefined()
      }
      expect(recargar).toHaveBeenCalledTimes(1)
    })
    it('revocar borra las claves de Google y Meta de localStorage / sessionStorage y respeta la decisión de cookies', () => {
      cargarMedicion(IDS)
      window.localStorage.setItem('_gcl_ls', 'x')
      window.localStorage.setItem('fbevents', 'x')
      window.sessionStorage.setItem('_ga_ABC123', 'x')
      window.localStorage.setItem('carrito', 'x')
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(window.localStorage.getItem('_gcl_ls')).toBeNull()
      expect(window.localStorage.getItem('fbevents')).toBeNull()
      expect(window.sessionStorage.getItem('_ga_ABC123')).toBeNull()
      expect(window.localStorage.getItem('carrito')).toBe('x')
      expect(window.localStorage.getItem('tienda:consentimiento-cookies')).toBe('rechazadas')
      window.localStorage.removeItem('carrito')
    })
    it('pasar de un campo a otro no dispara la recarga; sí soltar el foco hacia otra cosa', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      const formulario = document.createElement('form')
      const a = document.createElement('input')
      const b = document.createElement('input')
      formulario.append(a, b)
      document.body.appendChild(formulario)
      a.value = 'x'
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      a.value = ''
      a.focus()
      a.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: b }))
      expect(recargar).not.toHaveBeenCalled()
      a.blur()
      a.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      expect(recargar).toHaveBeenCalledTimes(1)
      formulario.remove()
    })
    it('un checkbox o radio cambiado impide recargar', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      const marca = document.createElement('input')
      marca.type = 'checkbox'
      document.body.appendChild(marca)
      marca.checked = true
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(recargar).not.toHaveBeenCalled()
      marca.checked = false
      retirarMedicion()
      expect(recargar).toHaveBeenCalledTimes(1)
      marca.remove()
    })
    it('con la recarga pendiente reintenta cada 5 s (pestaña visible) y al cambiar de ruta, y se cancela al recargar', () => {
      vi.useFakeTimers()
      try {
        cargarMedicion(IDS)
        scriptCargado(URL_GTAG)
        const dialogo = document.createElement('div')
        dialogo.setAttribute('role', 'dialog')
        document.body.appendChild(dialogo)
        guardarConsentimiento('rechazadas')
        retirarMedicion()
        vi.advanceTimersByTime(12000)
        expect(recargar).not.toHaveBeenCalled()
        dialogo.remove() // se cierra sin mover el foco
        vi.advanceTimersByTime(5000)
        expect(recargar).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(30000)
        expect(recargar).toHaveBeenCalledTimes(1) // temporizador cancelado
      } finally {
        vi.useRealTimers()
      }
    })
    it('la recarga pendiente también se intenta al cambiar de ruta de la SPA', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_GTAG)
      const dialogo = document.createElement('div')
      dialogo.setAttribute('role', 'dialog')
      document.body.appendChild(dialogo)
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      dialogo.remove()
      registrarVisita('/otra')
      expect(recargar).toHaveBeenCalledTimes(1)
    })
    it('un script de un ID de GA4 anterior que llega tarde (consentimiento vigente) queda inerte sin tocar el vigente', () => {
      cargarMedicion({ ga4_id: 'G-ABC123', meta_pixel_id: null })
      const viejo = Array.from(document.head.querySelectorAll('script')).find((n) => n.getAttribute('src')?.includes('G-ABC123'))!
      cargarMedicion({ ga4_id: 'G-NUEVO99', meta_pixel_id: null })
      document.cookie = '_ga_ABC123=GS1; path=/'
      delete (window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']
      viejo.onload?.(new Event('load'))
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      expect(cookiesActuales()).not.toContain('_ga_ABC123')
      expect((window as unknown as Record<string, unknown>).gtag).toBeDefined() // las del ID nuevo siguen
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-NUEVO99']).toBeUndefined()
    })
    it('quitar y volver a agregar el ID de Meta no duplica fbevents: espera a poder recargar', () => {
      cargarMedicion(IDS)
      scriptCargado(URL_PIXEL)
      const campo = document.createElement('textarea')
      document.body.appendChild(campo)
      campo.value = 'x'
      cargarMedicion({ ga4_id: 'G-ABC123', meta_pixel_id: null })
      cargarMedicion(IDS)
      expect(scripts().filter((src) => src === URL_PIXEL)).toHaveLength(0)
      expect(recargar).not.toHaveBeenCalled()
      campo.value = ''
      registrarVisita('/x')
      expect(recargar).toHaveBeenCalledTimes(1)
      campo.remove()
    })
    it('el storage se borra por proveedor y con claves exactas', () => {
      cargarMedicion(IDS)
      for (const k of ['_gcl_ls', '_ga_ABC123', '_fbp', 'fbevents', '_galeria', 'fbqueue', 'carrito']) window.localStorage.setItem(k, 'x')
      cargarMedicion({ ga4_id: null, meta_pixel_id: '123456789' }) // solo se quita Google
      expect(window.localStorage.getItem('_gcl_ls')).toBeNull()
      expect(window.localStorage.getItem('_ga_ABC123')).toBeNull()
      expect(window.localStorage.getItem('_fbp')).toBe('x')
      expect(window.localStorage.getItem('fbevents')).toBe('x')
      expect(window.localStorage.getItem('_galeria')).toBe('x')
      expect(window.localStorage.getItem('fbqueue')).toBe('x')
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      expect(window.localStorage.getItem('_fbp')).toBeNull()
      expect(window.localStorage.getItem('fbevents')).toBeNull()
      expect(window.localStorage.getItem('_galeria')).toBe('x')
      expect(window.localStorage.getItem('fbqueue')).toBe('x')
      expect(window.localStorage.getItem('carrito')).toBe('x')
      expect(window.localStorage.getItem('tienda:consentimiento-cookies')).toBe('rechazadas')
      for (const k of ['_galeria', 'fbqueue', 'carrito']) window.localStorage.removeItem(k)
    })
    it('Meta: `consent revoke` posterior a `init` sobre la pila real del píxel', () => {
      cargarMedicion({ ga4_id: null, meta_pixel_id: '123456789' })
      const pila = (window as unknown as { fbq: { queue: ArrayLike<unknown>[] } }).fbq
      guardarConsentimiento('rechazadas')
      retirarMedicion()
      const cola = pila.queue.map((x) => Array.from(x))
      const iInit = cola.findIndex((c) => c[0] === 'init')
      const iRevoke = cola.findIndex((c) => c[0] === 'consent' && c[1] === 'revoke')
      expect(iInit).toBeGreaterThanOrEqual(0)
      expect(iRevoke).toBeGreaterThan(iInit)
      expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined()
    })
    it('dominiosCookie: el host y cada dominio padre registrable (sin sufijos públicos como com.ar); nunca una IP', () => {
      expect(dominiosCookie('www.mundojc.com.ar')).toEqual([null, 'www.mundojc.com.ar', 'mundojc.com.ar'])
      expect(dominiosCookie('tienda.ejemplo.co.uk')).toEqual([null, 'tienda.ejemplo.co.uk', 'ejemplo.co.uk'])
      expect(dominiosCookie('ejemplo.com')).toEqual([null, 'ejemplo.com'])
      expect(dominiosCookie('localhost')).toEqual([null])
      expect(dominiosCookie('127.0.0.1')).toEqual([null])
    })
  })

  describe('cambio de ID de GA4 en la misma visita (hallazgo 4)', () => {
    it('descarga el script del ID anterior, limpia el dataLayer y carga el del ID nuevo', () => {
      cargarMedicion({ ga4_id: 'G-ABC123', meta_pixel_id: null })
      const capaVieja = (window as unknown as { dataLayer: unknown[] }).dataLayer
      cargarMedicion({ ga4_id: 'G-NUEVO99', meta_pixel_id: null })
      expect(scripts()).toEqual([`${URL_GTAG}?id=G-NUEVO99`])
      const capaNueva = (window as unknown as { dataLayer: unknown[] }).dataLayer
      expect(capaNueva).not.toBe(capaVieja)
      const texto = JSON.stringify(capaNueva.map((x) => Array.from(x as ArrayLike<unknown>)))
      expect(texto).toContain('G-NUEVO99')
      expect(texto).not.toContain('G-ABC123')
      expect((window as unknown as Record<string, unknown>)['ga-disable-G-ABC123']).toBe(true)
      registrarEventoTienda('busqueda')
      expect(capaNueva.map((x) => Array.from(x as ArrayLike<unknown>))).toContainEqual(['event', 'busqueda'])
    })
  })

  describe('script bloqueado por un bloqueador de anuncios (hallazgo 12)', () => {
    it('onerror de gtag/fbq apaga la herramienta, no rompe la tienda y no acumula eventos', () => {
      cargarMedicion(IDS)
      expect(() => {
        scriptFallido(URL_GTAG)
        scriptFallido(URL_PIXEL)
      }).not.toThrow()
      expect(hayMedicionCargada()).toBe(false)
      const w = window as unknown as Record<string, unknown>
      expect(w.dataLayer).toBeUndefined()
      expect(w.fbq).toBeUndefined()
      for (let i = 0; i < 200; i++) {
        registrarEventoTienda('busqueda')
        registrarVisita(`/p/${i}`)
      }
      expect(w.dataLayer).toBeUndefined()
      // Sin reintentos en esta visita: no se vuelven a agregar los scripts bloqueados ni se recarga.
      cargarMedicion(IDS)
      expect(scripts()).toEqual([])
      expect(w.dataLayer).toBeUndefined()
      expect(recargar).not.toHaveBeenCalled()
    })
    it('si solo falla uno, el otro sigue midiendo', () => {
      cargarMedicion(IDS)
      scriptFallido(URL_PIXEL)
      registrarEventoTienda('clic_whatsapp')
      const capa = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((x) => Array.from(x))
      expect(capa).toContainEqual(['event', 'clic_whatsapp'])
      expect(hayMedicionCargada()).toBe(true)
    })
  })
})
