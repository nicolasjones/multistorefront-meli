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
  await page.route(/googletagmanager\.com|connect\.facebook\.net/, (ruta) => {
    pedidos.push(ruta.request().url())
    return ruta.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  })
  return pedidos
}

const decidir = (page: Page, valor: 'aceptadas' | 'rechazadas') =>
  page.addInitScript(([clave, v]) => window.localStorage.setItem(clave, v), [CLAVE_CONSENTIMIENTO, valor] as const)

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
  await expect(page.getByRole('heading', { level: 1, name: producto.nombre })).toBeVisible()
  await page.getByRole('combobox', { name: 'Buscar productos' }).fill('joystick')
  await page.getByRole('combobox', { name: 'Buscar productos' }).press('Enter')
  await expect(page).toHaveURL(/\/catalogo\?q=joystick/)
  // La capa de datos se reinicia con cada carga completa de página: el evento de búsqueda se lee ANTES de volver a la ficha.
  const busquedas = await eventosDe(page, 'busqueda')
  await page.goto(`${base}/producto/${producto.id}`)
  await expect(page.getByRole('heading', { level: 1, name: producto.nombre })).toBeVisible()
  await pulsarAbrirWhatsapp(contexto, page)
  return { busquedas }
}

const capaDeDatos = (page: Page) =>
  page.evaluate(() => ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((x) => Array.from(x)))

test.describe('Tienda online · analítica de visitas (SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-315:T028] consentimiento, IDs por tienda, aceptación tardía, visitas, contacto y tienda desactivada', async ({ browser }) => {
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
        await expect(page.getByRole('region', { name: 'Aviso de cookies' })).toBeVisible()
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
        await expect.poll(() => pedidos.some((p) => p.includes(`id=${t.ga4}`))).toBe(true)
        await expect.poll(() => pedidos.some((p) => p.includes('fbevents.js'))).toBe(true)
        expect(pedidos.some((p) => p.includes(otra.ga4)), `${t.host} no carga el ID de ${otra.nombre}`).toBe(false)
        await expect.poll(async () => (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'page_view').length).toBe(1)

        await page.goto(`${base}/contacto`)
        await expect.poll(async () => (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'page_view').length).toBeGreaterThanOrEqual(1)

        // 4) Envío de contacto confirmado → evento `envio_contacto` (solo el nombre, sin datos del visitante).
        await page.getByLabel(/^Nombre/).fill(`E2E analítica ${sufijo}`)
        await page.getByLabel(/^Correo o WhatsApp/).fill('visitante@ejemplo.com')
        await page.getByLabel(/^Mensaje/).fill(`Consulta de analítica ${sufijo}`)
        await page.getByRole('button', { name: 'Enviar consulta' }).click()
        await expect(page.getByRole('heading', { name: '¡Gracias! Recibimos tu consulta' })).toBeVisible()
        const eventos = (await capaDeDatos(page)).filter((e) => e[0] === 'event' && e[1] === 'envio_contacto')
        expect(eventos).toEqual([['event', 'envio_contacto']])

        // 4b) Eventos de la tienda (RF-TDA-24-2): vista de producto, búsqueda y clic en WhatsApp, solo con su nombre.
        const { busquedas } = await recorrer(contexto, page, base, productos.get(t.host)!)
        expect(await eventosDe(page, 'vista_producto')).toEqual([['event', 'vista_producto']])
        expect(busquedas).toEqual([['event', 'busqueda']])
        expect(await eventosDe(page, 'clic_whatsapp')).toEqual([['event', 'clic_whatsapp']])

        // 4c) Acepta y luego revoca con la página abierta: no se emite ningún evento más.
        const antes = await contarEventos(page)
        await page.evaluate((clave) => {
          window.localStorage.setItem(clave, 'rechazadas')
          window.dispatchEvent(new CustomEvent('tienda:consentimiento-cookies', { detail: 'rechazadas' }))
        }, CLAVE_CONSENTIMIENTO)
        await pulsarAbrirWhatsapp(contexto, page)
        await page.getByRole('combobox', { name: 'Buscar productos' }).fill('otra cosa')
        await page.getByRole('combobox', { name: 'Buscar productos' }).press('Enter')
        expect(await contarEventos(page), 'tras revocar no se emite ningún evento más').toBe(antes)
        await contexto.close()

        // 5) Aceptación tardía: sin decisión no hay pedidos; al aceptar en el aviso, se cargan en ese momento.
        contexto = await browser.newContext()
        page = await contexto.newPage()
        pedidos = await interceptarMedicion(page)
        await page.goto(`${base}/`)
        await page.waitForLoadState('networkidle')
        expect(pedidos).toEqual([])
        await page.getByRole('region', { name: 'Aviso de cookies' }).getByRole('button', { name: 'Aceptar' }).click()
        await expect.poll(() => pedidos.some((p) => p.includes(`id=${t.ga4}`))).toBe(true)
        await contexto.close()
      }

      // 7) Vista previa del panel (FR-014, CA-TDA-24-2): aunque haya consentimiento, no carga ningún script.
      {
        const t = TIENDAS[1]
        const correo = `admin-analitica-${sufijo}@example.com`
        usuarioPanel = await altaAdministrador(correo, t.organizacion)
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
        await expect(page.getByRole('heading', { name: 'Vista previa de la tienda' })).toBeVisible()
        await expect(page.getByTestId('vista-previa-tienda')).toBeVisible()
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
        await expect(page.getByRole('heading', { name: 'Volvemos pronto' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        expect(pedidos, 'una tienda desactivada no carga ningún script').toEqual([])
        await contexto.close()
      } finally {
        await actualizar('empresas', `id=eq.${desactivada.empresa}`, { activa: true })
      }
    } finally {
      if (usuarioPanel) {
        await fetch(`${url}/rest/v1/usuarios_organizacion?user_id=eq.${usuarioPanel}`, {
          method: 'DELETE',
          headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}` },
        })
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
    }
  })
})
