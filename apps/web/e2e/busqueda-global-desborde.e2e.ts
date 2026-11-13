import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, serviceKey, url } from './importaciones-soporte'
import { paso, prepararPaginaVisible } from './visible'

// [MSF-842] La búsqueda global de la barra superior no desborda la página a 320 px.
// La región viva del anuncio (`role="status"`, `aria-live="polite"`) es texto «solo para lectores»:
// con `width: 1` en el `sx` de MUI mide 100 % del contenedor (no 1 px) y su caja, aunque esté
// recortada con `clip`, empuja el scroll horizontal de la página a 320 px. Requiere el stack local
// (`pnpm dev:supabase`); siembra con la API admin desde Node (la service-role key nunca llega al
// navegador).
const password = 'Correcta-12345!'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'POST', headers: cabeceras({ prefer: 'return=representation' }), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function borrar(destino: string) {
  const r = await fetch(destino, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${destino} → ${r.status}`)
}

test.describe('Búsqueda global: la barra superior no desborda la página (MSF-842)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-842:BUG] la región viva del anuncio mide 1 px y la página no desborda a 320 px', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `busqueda-global-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      ;[{ id: orgId }] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E búsqueda global ${sufijo}` }])
      const alta = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
      if (!alta.ok) throw new Error(`alta de ${correo}: ${alta.status} ${await alta.text()}`)
      userId = ((await alta.json()) as { id: string }).id
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: orgId, rol_id: 'administrador' })

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, correo)
      await paso(page, 'la barra superior a 320 px', async () => {
        await page.setViewportSize({ width: 320, height: 900 })
        await page.goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await page.waitForLoadState('networkidle')
      })

      // La región viva del anuncio es un texto «solo para lectores»: 1 px, no el 100 % del contenedor.
      const regiones = page.locator('[role="status"][aria-live="polite"]')
      const cantidad = await regiones.count()
      expect(cantidad).toBeGreaterThan(0)
      for (let i = 0; i < cantidad; i++) {
        await expect(regiones.nth(i)).toHaveCSS('width', '1px')
      }

      // Y la página no gana scroll horizontal a 320 px.
      const medidas = await page.evaluate(() => {
        const raiz = document.documentElement
        const ancho = raiz.clientWidth
        const culpables = Array.from(document.querySelectorAll('body *'))
          .filter((e) => e.getBoundingClientRect().right > ancho + 1)
          .slice(0, 5)
          .map((e) => `${e.tagName}.${String(e.className).split(' ').slice(0, 2).join('.')}`)
        return { scrollWidth: raiz.scrollWidth, clientWidth: ancho, culpables }
      })
      expect(medidas.scrollWidth, `la barra superior desborda a 320 px: ${medidas.culpables.join(', ')}`).toBeLessThanOrEqual(medidas.clientWidth)
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (orgId) {
        await borrar(`${url}/rest/v1/usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`${url}/rest/v1/organizaciones?id=eq.${orgId}`)
      }
      if (userId) await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: cabeceras() })
    }
  })
})
