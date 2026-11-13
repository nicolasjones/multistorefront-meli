import { randomUUID } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { limpiarOrganizacion, rest } from './soporte/fixtures'

// F-TDA-14 (MSF-433, SC-008 de la épica MSF-212): con dos tiendas propias de la corrida (cada una con su dominio) la ficha muestra el botón «Consultar por WhatsApp», el diálogo arma el mensaje
// con el producto y el precio, «Abrir WhatsApp» abre `wa.me` en una pestaña nueva (la URL se verifica y
// la red no se toca) y la consulta llega a la bandeja de Consultas y ventas de SU empresa con origen
// «whatsapp» y el producto; una empresa sin número no muestra el botón. Requiere el stack local
// (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra y lee la bandeja con la
// API admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de WhatsApp: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

async function leer<T>(consulta: string): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${consulta}`, { headers: cabeceras() })
  if (!r.ok) throw new Error(`REST GET ${consulta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function insertar<T>(tabla: string, cuerpo: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation' }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${tabla}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST PATCH ${tabla}: ${r.status} ${await r.text()}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

type Consulta = { id: string; origen: string; empresa_id: string; producto_id: string | null; nombre: string; contacto: string }

// La consulta por WhatsApp se registra sin bloquear la apertura (FR-024): se espera a que llegue.
async function esperarConsultas(filtro: string, cuanto = 20): Promise<Consulta[]> {
  for (let intento = 0; intento < cuanto; intento++) {
    const consultas = await leer<Consulta>(`consultas?select=id,origen,empresa_id,producto_id,nombre,contacto&${filtro}`)
    if (consultas.length > 0) return consultas
    await new Promise((resolver) => setTimeout(resolver, 500))
  }
  return []
}

// La URL de WhatsApp se verifica sin salir a la red: `wa.me` se responde con una página muda.
async function abrirWhatsapp(context: BrowserContext, page: Page) {
  await context.route('https://wa.me/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="es"><body>WhatsApp (simulado)</body></html>' }),
  )
  const [emergente] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Abrir WhatsApp' }).click(),
  ])
  await emergente.waitForLoadState('domcontentloaded')
  const urlAbierta = emergente.url()
  await emergente.close()
  return urlAbierta
}

test.describe('Tienda online · consulta por WhatsApp desde la ficha (SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('ficha → diálogo → WhatsApp → bandeja de su empresa, y ficha sin botón si no hay número', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const orgs: string[] = []
    // Organización, empresa y tienda PROPIAS por corrida (no las del demo, que no se pueden limpiar): la baja de la organización
    // se lleva consultas, productos y categorías.
    const tiendas: Array<{
      host: string; organizacion: string; empresa: string; nombre: string; indice: number; whatsapp: string; digitos: string
      producto: string; sku: string; categoria: string; productoId: string
    }> = []
    for (const i of [0, 1]) {
      const nombre = `Tienda WhatsApp ${i} ${sufijo}`
      const whatsapp = `+54 9 11 5550-00${i}${i}`
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E WhatsApp ${i} ${sufijo}` })
      orgs.push(org.id)
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre, whatsapp }, 'dominio')
      const host = `wa-${i}-${sufijo}.localhost`
      await rest('tiendas', { organizacion_id: org.id, empresa_id: empresa.id, dominio: host }, 'dominio')
      tiendas.push({
        host, organizacion: org.id, empresa: empresa.id, nombre, indice: i, whatsapp,
        // Solo dígitos: el número que se ve es el que tiene la empresa.
        digitos: whatsapp.replace(/\D/g, ''),
        producto: `Producto WhatsApp ${nombre}`,
        sku: `E2E-WA-${i}-${sufijo}`,
        categoria: `Cat WhatsApp ${nombre}`,
        productoId: '',
      })
    }

    try {
      for (const t of tiendas) {
        const [categoria] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: t.categoria }])
        const [producto] = await insertar<{ id: string }>('productos', [
          { organizacion_id: t.organizacion, nombre: t.producto, sku: t.sku, precio_lista: 1000, moneda: 'ARS', categoria_id: categoria.id },
        ])
        t.productoId = producto.id
        await insertar('producto_empresa', [{ producto_id: producto.id, empresa_id: t.empresa, organizacion_id: t.organizacion }])
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        await page.goto(`http://${t.host}:${puerto}/producto/${t.productoId}`)

        // La ficha muestra el botón y el mensaje va armado con el producto y el precio.
        await expect(page.getByRole('heading', { level: 1, name: t.producto })).toBeVisible()
        const boton = page.getByRole('button', { name: 'Consultar por WhatsApp' })
        await expect(boton).toBeVisible()
        const mensaje = `Hola ${t.nombre}, quiero consultar por ${t.producto} ($ 1.000). ¿Está disponible?`
        await boton.click()
        const dialogo = page.getByRole('dialog')
        await expect(dialogo).toBeVisible()
        await expect(dialogo.getByText(`${t.nombre} · ${t.whatsapp}`)).toBeVisible()
        await expect(page.getByLabel('Mensaje que se va a enviar')).toHaveValue(mensaje)

        // «Abrir WhatsApp» abre wa.me en una pestaña nueva (la URL se verifica; la red no se toca).
        const urlAbierta = await abrirWhatsapp(contexto, page)
        const prefijo = `https://wa.me/${t.digitos}?text=`
        expect(urlAbierta.startsWith(prefijo)).toBe(true)
        // El mensaje va codificado (sin espacios sueltos) y decodifica exactamente al armado.
        expect(urlAbierta).not.toContain(' ')
        expect(decodeURIComponent(urlAbierta.slice(prefijo.length))).toBe(mensaje)
        await expect(dialogo).toBeHidden()
        await expect(page.getByText('Se abrió WhatsApp con el mensaje listo.')).toBeVisible()

        // La consulta llegó a la bandeja de SU empresa, con origen whatsapp y el producto.
        const consultas = await esperarConsultas(`empresa_id=eq.${t.empresa}&origen=eq.whatsapp&producto_id=eq.${t.productoId}`)
        expect(consultas).toHaveLength(1)
        expect(consultas[0].empresa_id).toBe(t.empresa)
        expect(consultas[0].origen).toBe('whatsapp')
        expect(consultas[0].producto_id).toBe(t.productoId)
        // El visitante no dejó datos: se registra con las marcas, no con un nombre inventado.
        expect(consultas[0].nombre).toBe('Visitante de WhatsApp')
        expect(consultas[0].contacto).toBe('visitante@sin-datos.invalid')

        // La bandeja de la otra empresa no recibe nada de ESTE producto (la otra ya consultó el suyo en su vuelta).
        const ajenas = await leer<Consulta>(`consultas?select=id,origen,empresa_id,producto_id,nombre,contacto&empresa_id=eq.${otra.empresa}&origen=eq.whatsapp&producto_id=eq.${t.productoId}`)
        expect(ajenas).toHaveLength(0)

        await contexto.close()
      }

      // A 320 px el botón de WhatsApp ocupa el ancho completo de la fila de acciones (como el prototipo móvil, donde «Ver más productos»
      // no se dibuja): el ancho lo lleva el elemento que la fila
      // acomoda, no el botón — un `width: 100%` dentro de un contenedor de ancho automático se
      // resuelve como `auto` y el botón quedaría más angosto.
      const celula = tiendas[0]
      const contextoCelular = await browser.newContext({ viewport: { width: 320, height: 800 } })
      const pageCelular = await contextoCelular.newPage()
      await pageCelular.goto(`http://${celula.host}:${puerto}/producto/${celula.productoId}`)
      const botonCelular = pageCelular.getByRole('button', { name: 'Consultar por WhatsApp' })
      await expect(botonCelular).toBeVisible()
      const cajaBoton = await botonCelular.boundingBox()
      const cajaFila = await pageCelular.getByTestId('acciones-ficha').boundingBox()
      expect(Math.abs(cajaBoton!.width - cajaFila!.width)).toBeLessThanOrEqual(2)
      await contextoCelular.close()

      // Una empresa sin número no muestra el botón: la ficha se ve sin botón y sin hueco.
      const sinNumero = tiendas[1]
      await actualizar('empresas', `id=eq.${sinNumero.empresa}`, { whatsapp: null })
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await page.goto(`http://${sinNumero.host}:${puerto}/producto/${sinNumero.productoId}`)
      await expect(page.getByRole('heading', { level: 1, name: sinNumero.producto })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Consultar por WhatsApp' })).toHaveCount(0)
      await expect(page.getByTestId('acciones-ficha')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Ver más productos' })).toBeVisible()
      await contexto.close()
    } finally {
      for (const org of orgs) await limpiarOrganizacion(org)
    }
  })
})
