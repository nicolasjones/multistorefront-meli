import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// [MSF-306:T009] F-TDA-23 (SC-002, SC-003 de la épica MSF-164): con los dos dominios del seed
// (mundojc.localhost y sanjavucho.localhost), una página de contenido nace oculta (no está en el pie y su
// ruta da la 404), al hacerla visible aparece en el pie de SU tienda y se lee en /pagina/<slug>, ocultarla o
// eliminarla vuelve a dar la 404, ambas tiendas con el mismo slug «envios» leen cada una la suya, y el HTML
// escrito queda literal. Las páginas se siembran y cambian con la API admin desde Node (la service-role key
// nunca llega al navegador); el alta/edición/borrado desde el panel (diálogo, validación, confirmación) lo
// cubre `paginas.test.tsx`. Se verifica a 320 / 768 / 1440 px. Requiere el stack local (`pnpm dev:supabase`,
// que aplica `supabase/seed.sql`) y la web servida; sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de páginas: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  { host: 'mundojc.localhost', empresa: '0f5eed01-0000-4000-8000-000000000001', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', empresa: '0f5eed01-0000-4000-8000-000000000002', nombre: 'San Javucho' },
] as const

const ANCHOS = [320, 768, 1440]

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: metodo,
    headers: cabeceras({ prefer: 'return=representation' }),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

type Fila = { id: string; organizacion_id: string }

test.describe('Tienda online · páginas de contenido con dos tiendas (SC-002, SC-003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-306:T009] oculta → visible → pie y lectura → ocultar/eliminar da 404 → cada tienda la suya', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const titulo = `Envíos ${sufijo}`
    const slug = `envios-${sufijo}`
    const paginas: Array<{ host: string; nombre: string; id: string; texto: string }> = []

    try {
      for (const t of TIENDAS) {
        const [empresa] = await pedir<Fila>('GET', `empresas?select=id,organizacion_id&id=eq.${t.empresa}`)
        const texto = `Despachamos desde ${t.nombre} ${sufijo}`
        const [fila] = await pedir<Fila>('POST', 'tienda_paginas', {
          organizacion_id: empresa.organizacion_id,
          empresa_id: t.empresa,
          titulo,
          slug,
          contenido: `${texto}\n\n<script>window.__xss = 1</script>`,
          visible: false,
        })
        paginas.push({ host: t.host, nombre: t.nombre, id: fila.id, texto })
      }

      for (const ancho of ANCHOS) {
        await page.setViewportSize({ width: ancho, height: 900 })

        // Oculta: no está en el pie y la ruta da la 404 (en ambas tiendas).
        for (const p of paginas) {
          await pedir('PATCH', `tienda_paginas?id=eq.${p.id}`, { visible: false })
          await page.goto(`http://${p.host}:${puerto}/`)
          await expect(page.getByTestId('pie-contacto').getByRole('link', { name: 'Escribinos' })).toBeVisible()
          await expect(page.getByRole('link', { name: titulo })).toHaveCount(0)
          await page.goto(`http://${p.host}:${puerto}/pagina/${slug}`)
          await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
        }

        // Visible: aparece en el pie de SU tienda y se lee con su propio texto; el HTML queda literal.
        for (const p of paginas) {
          await pedir('PATCH', `tienda_paginas?id=eq.${p.id}`, { visible: true })
          await page.goto(`http://${p.host}:${puerto}/`)
          const enlace = page.getByTestId('pie-informacion').getByRole('link', { name: titulo })
          await expect(enlace).toBeVisible()
          await enlace.click()
          await expect(page).toHaveURL(new RegExp(`/pagina/${slug}$`))
          await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
          await expect(page.getByTestId('pagina-contenido')).toContainText(p.texto)
          await expect(page.getByText('<script>window.__xss = 1</script>')).toBeVisible()
          expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
          for (const otra of paginas.filter((x) => x.host !== p.host)) {
            await expect(page.getByText(otra.texto)).toHaveCount(0)
          }
        }
      }

      // Ocultar y eliminar: el enlace desaparece del pie y la ruta da 404.
      const [primera, segunda] = paginas
      await pedir('PATCH', `tienda_paginas?id=eq.${primera.id}`, { visible: false })
      await page.goto(`http://${primera.host}:${puerto}/pagina/${slug}`)
      await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
      await expect(page.getByTestId('pie-informacion')).toHaveCount(0)

      await pedir('DELETE', `tienda_paginas?id=eq.${segunda.id}`)
      await page.goto(`http://${segunda.host}:${puerto}/pagina/${slug}`)
      await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
    } finally {
      await pedir('DELETE', `tienda_paginas?slug=eq.${slug}`).catch(() => undefined)
    }
  })
})
