import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-TDA-22 (MSF-289, SC-010 de la épica MSF-149): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) el pie muestra la información legal de SU empresa, el bloque desaparece sin datos y el
// aviso de cookies se va al decidir y no vuelve. Requiere el stack local (`pnpm dev:supabase`) y la web servida;
// siembra con la API admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E legal: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001', cuit: '30711111114', cuitFormato: '30-71111111-4' },
  { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002', cuit: '30722222223', cuitFormato: '30-72222222-3' },
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

async function insertar(tabla: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST POST ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test.describe('Tienda online · información legal y cookies (SC-010)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-289:T047] pie legal de cada tienda, bloque oculto sin datos y aviso de cookies que no vuelve', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const originales = await leer<{ id: string; razon_social: string | null; cuit: string | null; direccion: string | null }>(
      `empresas?select=id,razon_social,cuit,direccion&id=in.(${TIENDAS.map((t) => t.empresa).join(',')})`,
    )
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      razonSocial: `Legal ${i} ${sufijo} S.A.`,
      direccion: `Calle ${i} ${sufijo}`,
      enlace: `Política ${i} ${sufijo}`,
      urlEnlace: `https://legal-${i}-${sufijo}.ejemplo.com/politica`,
    }))

    try {
      for (const t of tiendas) {
        await actualizar('empresas', `id=eq.${t.empresa}`, { razon_social: t.razonSocial, cuit: t.cuit, direccion: t.direccion })
        await insertar('tienda_legal_enlaces', { organizacion_id: t.organizacion, empresa_id: t.empresa, titulo: t.enlace, url: t.urlEnlace, orden: 1 })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        for (const ancho of [320, 768, 1440]) {
          const contexto = await browser.newContext({ viewport: { width: ancho, height: 900 } })
          const page = await contexto.newPage()
          await page.goto(`http://${t.host}:${puerto}/`)

          // El pie muestra los datos de ESTA empresa y de ninguna otra.
          const pie = page.getByRole('region', { name: 'Información legal' })
          await expect(pie).toContainText(`${t.razonSocial} · CUIT ${t.cuitFormato}`)
          await expect(pie).toContainText(t.direccion)
          const enlace = pie.getByRole('link', { name: t.enlace })
          await expect(enlace).toHaveAttribute('href', t.urlEnlace)
          await expect(enlace).toHaveAttribute('target', '_blank')
          await expect(enlace).toHaveAttribute('rel', 'noopener noreferrer')
          await expect(page.getByText(otra.razonSocial)).toHaveCount(0)

          // Aviso de cookies: visible, no bloquea, y al decidir desaparece y no vuelve.
          const aviso = page.getByRole('region', { name: 'Aviso de cookies' })
          await expect(aviso).toBeVisible()
          await aviso.getByRole('button', { name: ancho === 768 ? 'Rechazar' : 'Aceptar' }).click()
          await expect(aviso).toHaveCount(0)
          await page.reload()
          await expect(page.getByRole('region', { name: 'Información legal' })).toBeVisible()
          await expect(page.getByRole('region', { name: 'Aviso de cookies' })).toHaveCount(0)
          await contexto.close()
        }
      }

      // Sin datos legales el bloque no aparece.
      const vacia = tiendas[0]!
      await actualizar('empresas', `id=eq.${vacia.empresa}`, { razon_social: null, cuit: null, direccion: null })
      await borrar('tienda_legal_enlaces', `empresa_id=eq.${vacia.empresa}`)
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await page.goto(`http://${vacia.host}:${puerto}/`)
      await expect(page.getByTestId('pie-contacto').getByRole('link', { name: 'Escribinos' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Información legal' })).toHaveCount(0)
      await contexto.close()
    } finally {
      for (const t of tiendas) {
        await borrar('tienda_legal_enlaces', `empresa_id=eq.${t.empresa}&titulo=like.*${sufijo}`)
        const o = originales.find((x) => x.id === t.empresa)
        if (o) await actualizar('empresas', `id=eq.${t.empresa}`, { razon_social: o.razon_social, cuit: o.cuit, direccion: o.direccion })
      }
    }
  })
})
