import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixture'

// F-TDA-24 (MSF-315, SC-006 de la épica MSF-164): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost), cada uno con SUS identificadores de medición: sin consentimiento (o con cookies
// rechazadas) no hay ningún pedido a los dominios de Google ni de Meta; con consentimiento cada tienda carga los
// suyos y de ninguna otra; los cuatro eventos (vista_producto, busqueda, clic_whatsapp, envio_contacto) se emiten
// solo con consentimiento vigente y dejan de emitirse si se revoca; la vista previa del panel no carga nada; si la persona acepta con la página abierta se cargan en ese momento; cada navegación
// registra una visita; el envío del formulario de contacto emite `envio_contacto`; y una tienda desactivada no
// carga nada. Los pedidos a esos dominios se interceptan (no salen a internet). Requiere el stack local
// (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de analítica: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241) y los identificadores de medición de cada tienda.
const TIENDAS = [
  { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001', nombre: 'Mundo JC', ga4: 'G-MUNDOJC1', pixel: '111111111' },
  { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002', nombre: 'San Javucho', ga4: 'G-SANJAVU1', pixel: '222222222' },
] as const

// Plazo explícito de las esperas de medición: con la máquina cargada los 5 s por defecto no alcanzan.
const PLAZO_MEDICION = 30_000

const CLAVE_CONSENTIMIENTO = 'tienda:consentimiento-cookies'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

async function insertar(tabla: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${tabla}: ${r.status} ${await r.text()}`)
}

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

// Intercepta los pedidos a los dominios de medición: los registra y los responde vacíos (no salen a internet).
async function interceptarMedicion(page: Page): Promise<string[]> {
  const pedidos: string[] = []
  // Scripts (gtag/js, fbevents.js) y también los envíos de datos (g/collect, facebook.com/tr, doubleclick).
  await page.route(/googletagmanager\.com|google-analytics\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr/, (ruta) => {
    pedidos.push(ruta.request().url())
    return ruta.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  })
  // Este spec mide analítica, no la bandeja de consultas: las dos RPC públicas que crearían consultas (WhatsApp y
  // formulario de contacto) se responden «ok» sin llegar a la base. Así no quedan consultas que apunten a los productos
  // sembrados (FK sin cascada) y no hace falta borrarlas (service_role no puede escribir en `consultas`).
  await page.route(/\/rest\/v1\/rpc\/(registrar_consulta_whatsapp|enviar_consulta_contacto)/, (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ estado: 'ok' }) }),
  )
  return pedidos
}

// Decisión INICIAL de la persona. Solo se siembra si todavía no hay una: el script corre en cada carga completa y, si
// pisara la decisión guardada, una recarga posterior a revocar (la tienda recarga para soltar los scripts de Google y
// Meta) volvería a «aceptadas» y reanudaría la medición, cosa que en un navegador real no pasa.
const decidir = (page: Page, valor: 'aceptadas' | 'rechazadas') =>
  page.addInitScript(
    ([clave, v]) => {
      if (window.localStorage.getItem(clave) === null) window.localStorage.setItem(clave, v)
    },
    [CLAVE_CONSENTIMIENTO, valor] as const,
  )

// Alta de un usuario administrador del panel (auth admin API) y de su pertenencia a la organización del seed.
async function altaAdministrador(correo: string, organizacion: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  const id = ((await r.json()) as { id: string }).id
  const m = await fetch(`${url}/rest/v1/usuarios_organizacion`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: id, organizacion_id: organizacion, rol_id: 'administrador' }),
  })
  if (!m.ok) throw new Error(`membresía de ${correo}: ${m.status} ${await m.text()}`)
  return id
}

async function bajaUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}` } })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

// Abre «Consultar por WhatsApp» y pulsa «Abrir WhatsApp» (wa.me se responde vacío: la red no se toca).
async function pulsarAbrirWhatsapp(contexto: BrowserContext, page: Page) {
  await contexto.route('https://wa.me/**', (ruta) => ruta.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="es"><body></body></html>' }))
  await page.getByRole('button', { name: 'Consultar por WhatsApp' }).click()
  const [emergente] = await Promise.all([contexto.waitForEvent('page'), page.getByRole('button', { name: 'Abrir WhatsApp' }).click()])
  await emergente.close()
}

const NOMBRES_EVENTO = ['page_view', 'vista_producto', 'busqueda', 'clic_whatsapp', 'envio_contacto']
const contarEventos = async (page: Page) =>
  (await capaDeDatos(page)).filter((e) => e[0] === 'event' && NOMBRES_EVENTO.includes(String(e[1]))).length
const eventosDe = async (page: Page, nombre: string) => (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === nombre)

// Recorre la tienda como visitante: ficha (vista_producto), búsqueda y clic en WhatsApp.
async function recorrer(contexto: BrowserContext, page: Page, base: string, producto: { id: string; nombre: string }) {
  await page.goto(`${base}/producto/${producto.id}`)
  await expect(page.getByRole('heading', { level: 1, name: producto.nombre })).toBeVisible({ timeout: PLAZO_MEDICION })
  await page.getByRole('combobox', { name: 'Buscar productos' }).fill('joystick')
  await page.getByRole('combobox', { name: 'Buscar productos' }).press('Enter')
  await expect(page).toHaveURL(/\/catalogo\?q=joystick/)
  // La capa de datos se reinicia con cada carga completa de página: el evento de búsqueda se lee ANTES de volver a la ficha.
  const busquedas = await eventosDe(page, 'busqueda')
  await page.goto(`${base}/producto/${producto.id}`)
  await expect(page.getByRole('heading', { level: 1, name: producto.nombre })).toBeVisible({ timeout: PLAZO_MEDICION })
  await pulsarAbrirWhatsapp(contexto, page)
  return { busquedas }
}

const capaDeDatos = (page: Page) =>
  page.evaluate(() => ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((x) => Array.from(x)))

test.describe('Tienda online · analítica de visitas (SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-315:T028] consentimiento, IDs por tienda, aceptación tardía, visitas, contacto y tienda desactivada', async ({ browser }) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const productos = new Map<string, { id: string; nombre: string }>()
    let usuarioPanel: string | null = null

    try {
      for (const [i, t] of TIENDAS.entries()) {
        const nombre = `Joystick analítica ${t.nombre} ${sufijo}`
        const [p] = (await (await fetch(`${url}/rest/v1/productos`, {
          method: 'POST',
          headers: cabeceras({ prefer: 'return=representation' }),
          body: JSON.stringify([{ organizacion_id: t.organizacion, nombre, sku: `E2E-A-${i}-${sufijo}`, precio_lista: 1000, moneda: 'ARS' }]),
        })).json()) as { id: string }[]
        await insertar('producto_empresa', [{ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion }])
        productos.set(t.host, { id: p.id, nombre })
      }
      for (const t of TIENDAS) {
        await insertar('tienda_analitica', [{ empresa_id: t.empresa, organizacion_id: t.organizacion, ga4_id: t.ga4, meta_pixel_id: t.pixel }])
        // El cupo de consultas es por visitante y empresa; se parte de cero (como tienda-contacto.e2e.ts).
        await borrar('tienda_envios', `empresa_id=eq.${t.empresa}`)
        await actualizar('empresas', `id=eq.${t.empresa}`, { whatsapp: '+54 9 11 5550-0000', correo: `analitica-${sufijo}@ejemplo.com`, horarios: `Horario ${sufijo}` })
      }

      for (const t of TIENDAS) {
        const otra = TIENDAS.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`

        // 1) Sin decisión sobre las cookies: ningún pedido a Google ni a Meta.
        let contexto = await browser.newContext()
        let page = await contexto.newPage()
        let pedidos = await interceptarMedicion(page)
        await page.goto(`${base}/`)
        await expect(page.getByRole('region', { name: 'Aviso de cookies' })).toBeVisible({ timeout: PLAZO_MEDICION })
        await page.waitForLoadState('networkidle')
        expect(pedidos, `sin decisión en ${t.host}`).toEqual([])
        // Sin decisión tampoco se mide al recorrer la tienda: ni pedidos ni eventos en la capa de datos.
        await recorrer(contexto, page, base, productos.get(t.host)!)
        expect(pedidos, `recorrido sin decisión en ${t.host}`).toEqual([])
        expect(await capaDeDatos(page), `sin capa de datos sin decisión en ${t.host}`).toEqual([])
        await contexto.close()

        // 2) Cookies rechazadas: tampoco.
        contexto = await browser.newContext()
        page = await contexto.newPage()
        pedidos = await interceptarMedicion(page)
        await decidir(page, 'rechazadas')
        await page.goto(`${base}/`)
        await page.waitForLoadState('networkidle')
        // «Rechazadas» ya es una decisión: el aviso no reaparece y nada se mide.
        await expect(page.getByRole('region', { name: 'Aviso de cookies' })).toHaveCount(0)
        expect(pedidos, `rechazadas en ${t.host}`).toEqual([])
        await recorrer(contexto, page, base, productos.get(t.host)!)
        expect(pedidos, `recorrido con rechazadas en ${t.host}`).toEqual([])
        expect(await capaDeDatos(page), `sin capa de datos con rechazadas en ${t.host}`).toEqual([])
        await contexto.close()

        // 3) Cookies aceptadas: carga SUS identificadores y ninguno de la otra tienda; una visita por navegación.
        contexto = await browser.newContext()
        page = await contexto.newPage()
        pedidos = await interceptarMedicion(page)
        await decidir(page, 'aceptadas')
        await page.goto(`${base}/`)
        await expect.poll(() => pedidos.some((p) => p.includes(`id=${t.ga4}`)), { timeout: PLAZO_MEDICION }).toBe(true)
        await expect.poll(() => pedidos.some((p) => p.includes('fbevents.js')), { timeout: PLAZO_MEDICION }).toBe(true)
        expect(pedidos.some((p) => p.includes(otra.ga4)), `${t.host} no carga el ID de ${otra.nombre}`).toBe(false)
        await expect.poll(async () => (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'page_view').length, { timeout: PLAZO_MEDICION }).toBe(1)

        await page.goto(`${base}/contacto`)
        await expect.poll(async () => (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'page_view').length, { timeout: PLAZO_MEDICION }).toBeGreaterThanOrEqual(1)

        // 4) Envío de contacto confirmado → evento `envio_contacto` (solo el nombre, sin datos del visitante).
        await page.getByLabel(/^Nombre/).fill(`E2E analítica ${sufijo}`)
        await page.getByLabel(/^Correo o WhatsApp/).fill('visitante@ejemplo.com')
        await page.getByLabel(/^Mensaje/).fill(`Consulta de analítica ${sufijo}`)
        await page.getByRole('button', { name: 'Enviar consulta' }).click()
        await expect(page.getByRole('heading', { name: '¡Gracias! Recibimos tu consulta' })).toBeVisible({ timeout: PLAZO_MEDICION })
        const eventos = (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'envio_contacto')
        expect(eventos).toEqual([['event', 'envio_contacto']])

        // 4b) Eventos de la tienda (RF-TDA-24-2): vista de producto, búsqueda y clic en WhatsApp, solo con su nombre.
        const { busquedas } = await recorrer(contexto, page, base, productos.get(t.host)!)
        // La ficha puede resolver antes que los IDs de medición: el evento espera su turno y sale al cargarse (se sondea).
        await expect.poll(() => eventosDe(page, 'vista_producto'), { timeout: PLAZO_MEDICION }).toEqual([['event', 'vista_producto']])
        expect(busquedas).toEqual([['event', 'busqueda']])
        await expect.poll(() => eventosDe(page, 'clic_whatsapp'), { timeout: PLAZO_MEDICION }).toEqual([['event', 'clic_whatsapp']])

        // 4c) Acepta y luego revoca con la página abierta: se apaga todo y no sale ningún pedido ni evento más.
        // Huellas que dejan Google y Meta: cookies y almacenamiento propios del navegador; la revocación debe borrarlas.
        await page.evaluate((ga4) => {
          document.cookie = '_ga=GA1.1.111.222; path=/'
          document.cookie = `_ga_${ga4.slice(2)}=GS1.1.111; path=/`
          document.cookie = '_fbp=fb.1.111.222; path=/'
          window.localStorage.setItem('_ga', 'GA1.1.111.222')
          window.localStorage.setItem('_fbp', 'fb.1.111.222')
        }, t.ga4)
        const antes = await contarEventos(page)
        const pedidosAntes = pedidos.length // ANTES de revocar: todo lo que se pida desde acá es posterior a la decisión
        await page.evaluate((clave) => {
          window.localStorage.setItem(clave, 'rechazadas')
          window.dispatchEvent(new CustomEvent('tienda:consentimiento-cookies', { detail: 'rechazadas' }))
        }, CLAVE_CONSENTIMIENTO)
        // Las globales de medición desaparecen: sea porque se quitaron o porque la página se recargó (sin capa de datos).
        // Si la página se recarga justo en medio de la lectura, el contexto se destruye: se reintenta en vez de fallar.
        const leer = async <T>(lectura: () => T | Promise<T>): Promise<T | 'navegando'> => {
          try {
            return await page.evaluate(lectura)
          } catch (error) {
            if (String(error).includes('Execution context was destroyed')) return 'navegando'
            throw error
          }
        }
        await expect
          .poll(() => leer(() => [typeof (window as unknown as { dataLayer?: unknown }).dataLayer, typeof (window as unknown as { gtag?: unknown }).gtag, typeof (window as unknown as { fbq?: unknown }).fbq]), { timeout: PLAZO_MEDICION })
          .toEqual(['undefined', 'undefined', 'undefined'])
        await expect
          .poll(() => leer(() => ({ cookies: document.cookie, ga: window.localStorage.getItem('_ga'), fbp: window.localStorage.getItem('_fbp') })), { timeout: PLAZO_MEDICION })
          .toEqual({ cookies: '', ga: null, fbp: null })
        await pulsarAbrirWhatsapp(contexto, page)
        await page.getByRole('combobox', { name: 'Buscar productos' }).fill('otra cosa')
        await page.getByRole('combobox', { name: 'Buscar productos' }).press('Enter')
        await expect(page).toHaveURL(/\/catalogo\?q=otra\+cosa/)
        await page.waitForLoadState('networkidle')
        // La página pudo recargarse para soltar los scripts de terceros (capa de datos vacía): ningún evento nuevo, ningún
        // pedido a Google/Meta (scripts ni envíos) y la decisión sigue vigente.
        expect(await contarEventos(page), 'tras revocar no se emite ningún evento más').toBeLessThanOrEqual(antes)
        expect(await eventosDe(page, 'busqueda'), 'la búsqueda posterior a revocar no se mide').toEqual([])
        expect(pedidos.length, 'tras revocar no se pide nada a Google ni a Meta').toBe(pedidosAntes)
        expect(await page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_CONSENTIMIENTO)).toBe('rechazadas')
        await contexto.close()

        // 5) Aceptación tardía: sin decisión no hay pedidos; al aceptar en el aviso, se cargan en ese momento.
        contexto = await browser.newContext()
        page = await contexto.newPage()
        pedidos = await interceptarMedicion(page)
        await page.goto(`${base}/`)
        await page.waitForLoadState('networkidle')
        expect(pedidos).toEqual([])
        await page.getByRole('region', { name: 'Aviso de cookies' }).getByRole('button', { name: 'Aceptar' }).click()
        await expect.poll(() => pedidos.some((p) => p.includes(`id=${t.ga4}`)), { timeout: PLAZO_MEDICION }).toBe(true)
        await contexto.close()
      }

      // 7) Vista previa del panel (FR-014, CA-TDA-24-2): aunque haya consentimiento, no carga ningún script.
      {
        const t = TIENDAS[1]
        const correo = `admin-analitica-${sufijo}@example.com`
        usuarioPanel = await altaAdministrador(correo, t.organizacion)
        // La vista previa es de una sola empresa: la persona ya tiene elegida la suya (empresa activa).
        const activa = await fetch(`${url}/rest/v1/usuario_empresa_activa`, {
          method: 'POST',
          headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: usuarioPanel, empresa_id: t.empresa }),
        })
        if (!activa.ok) throw new Error(`empresa activa de ${correo}: ${activa.status} ${await activa.text()}`)
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        const pedidos = await interceptarMedicion(page)
        await decidir(page, 'aceptadas')
        await page.goto('/login')
        await page.getByLabel('Correo').fill(correo)
        await page.getByLabel('Contraseña').fill(password)
        await page.getByRole('button', { name: 'Ingresar' }).click()
        await expect(page).not.toHaveURL(/\/login/)
        await page.goto(`/empresas/${t.empresa}/tienda/vista-previa`)
        await expect(page.getByRole('heading', { name: 'Vista previa de la tienda' })).toBeVisible({ timeout: PLAZO_MEDICION })
        await expect(page.getByTestId('vista-previa-tienda')).toBeVisible({ timeout: PLAZO_MEDICION })
        await page.waitForLoadState('networkidle')
        expect(pedidos, 'la vista previa del panel no carga ningún script de medición').toEqual([])
        expect(await capaDeDatos(page)).toEqual([])
        await contexto.close()
      }

      // 6) Tienda desactivada: «Volvemos pronto» y ningún pedido de medición, aunque haya consentimiento.
      const desactivada = TIENDAS[0]
      await actualizar('empresas', `id=eq.${desactivada.empresa}`, { activa: false })
      try {
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        const pedidos = await interceptarMedicion(page)
        await decidir(page, 'aceptadas')
        await page.goto(`http://${desactivada.host}:${puerto}/`)
        await expect(page.getByRole('heading', { name: 'Volvemos pronto' })).toBeVisible({ timeout: PLAZO_MEDICION })
        await page.waitForLoadState('networkidle')
        expect(pedidos, 'una tienda desactivada no carga ningún script').toEqual([])
        await contexto.close()
      } finally {
        await actualizar('empresas', `id=eq.${desactivada.empresa}`, { activa: true })
      }
    } finally {
      if (usuarioPanel) {
        for (const tabla of ['usuario_empresa_activa', 'usuarios_organizacion']) {
          await fetch(`${url}/rest/v1/${tabla}?user_id=eq.${usuarioPanel}`, {
            method: 'DELETE',
            headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}` },
          })
        }
        await bajaUsuario(usuarioPanel)
      }
      for (const p of productos.values()) {
        await borrar('producto_empresa', `producto_id=eq.${p.id}`)
        await borrar('productos', `id=eq.${p.id}`)
      }
      for (const t of TIENDAS) {
        await borrar('tienda_analitica', `empresa_id=eq.${t.empresa}`)
        await borrar('tienda_envios', `empresa_id=eq.${t.empresa}`)
      }
      // Sin huérfanos: ningún producto sembrado por esta corrida (nombre con su sufijo) debe quedar en la base.
      const restantes = await fetch(`${url}/rest/v1/productos?select=id&nombre=like.*${sufijo}*`, { headers: cabeceras() })
      expect.soft(restantes.ok ? ((await restantes.json()) as unknown[]).length : -1, 'la limpieza no deja productos huérfanos').toBe(0)
    }
  })
})
