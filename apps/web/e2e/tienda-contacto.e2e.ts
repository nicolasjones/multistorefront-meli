import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-TDA-16 (MSF-437, SC-004 y SC-005 de la épica MSF-212): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) la página /contacto muestra los datos de SU tienda, una consulta enviada llega a la
// bandeja de Consultas y ventas de SU empresa con origen «formulario», una ráfaga de 6 envíos muestra la espera
// en el sexto y la bandeja recibe 5, y el HTML escrito queda literal. Requiere el stack local
// (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra y lee la bandeja con la API
// admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de contacto: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  { host: 'mundojc.localhost', empresa: '0f5eed01-0000-4000-8000-000000000001', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', empresa: '0f5eed01-0000-4000-8000-000000000002', nombre: 'San Javucho' },
] as const

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

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST PATCH ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

async function enviar(page: Page, nombre: string, mensaje: string) {
  await page.getByLabel(/^Nombre/).fill(nombre)
  await page.getByLabel(/^Correo o WhatsApp/).fill('visitante@ejemplo.com')
  await page.getByLabel(/^Mensaje/).fill(mensaje)
  await page.getByRole('button', { name: 'Enviar consulta' }).click()
}

type Consulta = { nombre: string; origen: string; mensaje: string; empresa_id: string }

test.describe('Tienda online · contacto con formulario (SC-004, SC-005)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('datos de cada tienda, consulta que llega a SU bandeja, ráfaga de 6 y HTML literal', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const originales = await leer<{ id: string; whatsapp: string | null; correo: string | null; horarios: string | null }>(
      `empresas?select=id,whatsapp,correo,horarios&id=in.(${TIENDAS.map((t) => t.empresa).join(',')})`,
    )
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      whatsapp: `+54 9 11 5550-00${i}${i}`,
      correo: `contacto-${i}-${sufijo}@ejemplo.com`,
      horarios: `Horario ${t.nombre} ${sufijo}`,
      visitante: `E2E contacto ${t.nombre} ${sufijo}`,
    }))

    try {
      for (const t of tiendas) {
        // El cupo es por visitante y empresa: se parte de cero para no depender de corridas anteriores.
        await borrar('tienda_envios', `empresa_id=eq.${t.empresa}`)
        await actualizar('empresas', `id=eq.${t.empresa}`, { whatsapp: t.whatsapp, correo: t.correo, horarios: t.horarios })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        await page.goto(`http://${t.host}:${puerto}/contacto`)

        // Datos de ESTA tienda y de ninguna otra.
        await expect(page.getByRole('heading', { level: 1, name: 'Contacto' })).toBeVisible()
        await expect(page.getByTestId('bloque-whatsapp')).toContainText(t.whatsapp)
        await expect(page.getByTestId('bloque-whatsapp')).toContainText(t.horarios)
        await expect(page.getByTestId('bloque-correo')).toContainText(t.correo)
        await expect(page.getByText(otra.correo)).toHaveCount(0)
        await expect(page.getByText(otra.horarios)).toHaveCount(0)

        // Validación por campo: no se envía nada.
        await page.getByRole('button', { name: 'Enviar consulta' }).click()
        await expect(page.getByText('Escribí tu nombre.')).toBeVisible()
        await expect(page.getByLabel(/^Nombre/)).toBeFocused()

        // Primer envío: confirmación y llegada a la bandeja de SU empresa con origen formulario.
        await enviar(page, `${t.visitante} 1`, 'Hola, ¿tienen stock?')
        await expect(page.getByRole('heading', { name: '¡Gracias! Recibimos tu consulta' })).toBeFocused()
        await page.getByRole('button', { name: 'Enviar otra' }).click()
        await expect(page.getByLabel(/^Nombre/)).toHaveValue('')

        // HTML literal: se guarda tal cual y la página no lo interpreta.
        await enviar(page, `${t.visitante} 2`, '<script>window.__xss = 1</script><b>negrita</b>')
        await page.getByRole('button', { name: 'Enviar otra' }).click()
        expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()

        // Envíos 3 a 5, y el sexto muestra la espera conservando lo escrito.
        for (const n of [3, 4, 5]) {
          await enviar(page, `${t.visitante} ${n}`, `Consulta número ${n}`)
          await page.getByRole('button', { name: 'Enviar otra' }).click()
        }
        await enviar(page, `${t.visitante} 6`, 'Consulta número 6')
        await expect(page.getByTestId('contacto-espera')).toContainText('Hiciste varias consultas seguidas. Probá de nuevo en')
        await expect(page.getByLabel(/^Mensaje/)).toHaveValue('Consulta número 6')

        // La bandeja recibió 5, todas de SU empresa y con origen formulario; la sexta no.
        const consultas = await leer<Consulta>(
          `consultas?select=nombre,origen,mensaje,empresa_id&nombre=like.${encodeURIComponent(`${t.visitante} *`)}&order=nombre`,
        )
        expect(consultas).toHaveLength(5)
        expect(consultas.every((c) => c.empresa_id === t.empresa && c.origen === 'formulario')).toBe(true)
        expect(consultas.find((c) => c.nombre.endsWith(' 2'))?.mensaje).toBe('<script>window.__xss = 1</script><b>negrita</b>')
        expect(consultas.some((c) => c.nombre.endsWith(' 6'))).toBe(false)

        await contexto.close()
      }
    } finally {
      for (const t of tiendas) {
        await borrar('consultas', `empresa_id=eq.${t.empresa}&nombre=like.${encodeURIComponent(`${t.visitante} *`)}`)
        await borrar('tienda_envios', `empresa_id=eq.${t.empresa}`)
        const original = originales.find((o) => o.id === t.empresa)
        if (original) await actualizar('empresas', `id=eq.${t.empresa}`, { whatsapp: original.whatsapp, correo: original.correo, horarios: original.horarios })
      }
    }
  })
})
