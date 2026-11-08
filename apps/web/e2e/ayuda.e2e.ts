import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, serviceKey, url, violacionesAxe } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible } from './visible'

// F-CFG-02 (MSF-385 · T015 · SC-003): el botón «Ayuda» abre un texto distinto y breve en tres pantallas distintas, se
// cierra con el teclado y devuelve el foco. La ayuda es contenido estático: este test solo necesita una persona
// administradora con sesión. Siembra con la API admin desde Node (la service-role key nunca llega al navegador); solo
// contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ayuda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

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

// Pantallas de prueba: ruta y nombre del panel de ayuda (= etiqueta del menú, FR-021).
const PANTALLAS = [
  { ruta: '/categorias', titulo: 'Categorías' },
  { ruta: '/ventas/comprobantes', titulo: 'Comprobantes' },
  { ruta: '/usuarios', titulo: 'Usuarios' },
] as const

test.describe('Ayuda dentro del panel (MSF-385)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-385:T015] tres pantallas abren textos distintos; cierre por teclado y foco devuelto', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `ayuda-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      ;[{ id: orgId }] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E ayuda ${sufijo}` }])
      const alta = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
      if (!alta.ok) throw new Error(`alta de ${correo}: ${alta.status} ${await alta.text()}`)
      userId = ((await alta.json()) as { id: string }).id
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: orgId, rol_id: 'administrador' })

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, correo)

      const textos: string[] = []
      for (const { ruta, titulo } of PANTALLAS) {
        await paso(page, `«Ayuda» en ${ruta} abre el texto de ${titulo}`, async () => {
          await page.goto(ruta)
          const boton = page.getByRole('button', { name: 'Ayuda' })
          await clic(page, boton)
          const dialogo = page.getByRole('dialog', { name: titulo })
          await expect(dialogo).toBeVisible()
          textos.push((await dialogo.textContent()) ?? '')
          expect(await violacionesAxe(page)).toEqual([])
          await page.keyboard.press('Escape')
          await expect(dialogo).toBeHidden()
          await expect(boton).toBeFocused()
        })
      }
      expect(new Set(textos).size, 'cada pantalla muestra una ayuda distinta').toBe(PANTALLAS.length)
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (orgId) {
        await fetch(`${url}/rest/v1/usuarios_organizacion?organizacion_id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
        await fetch(`${url}/rest/v1/organizaciones?id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
      }
      if (userId) await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: cabeceras() })
    }
  })
})
