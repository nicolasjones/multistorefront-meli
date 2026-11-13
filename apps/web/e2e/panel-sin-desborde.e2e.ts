import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, serviceKey, url, violacionesAxe } from './importaciones-soporte'
import { paso, prepararPaginaVisible } from './visible'

// Las pantallas de listado del panel no tienen scroll horizontal en la PÁGINA a 320, 375 y 1280 px. Cada pantalla se
// mide con `scrollWidth <= clientWidth` del documento (la tabla puede desplazarse dentro de su contenedor, la página no).
// Evita que vuelva el `width: 1` (= 100 % en sx de MUI) de los textos solo para lectores y los tabs/botones que no
// envuelven. Siembra una persona administradora con la API admin (la service-role key nunca llega al navegador).
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

const ANCHOS = [320, 375, 1280]
const RUTAS = ['/productos', '/clientes', '/consultas']

test.describe('Panel: listados sin scroll horizontal de la página', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('productos, clientes y consultas a 320, 375 y 1280 px', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `desborde-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      ;[{ id: orgId }] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E desborde ${sufijo}` }])
      const alta = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
      if (!alta.ok) throw new Error(`alta de ${correo}: ${alta.status} ${await alta.text()}`)
      userId = ((await alta.json()) as { id: string }).id
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: orgId, rol_id: 'administrador' })

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, correo)
      for (const ancho of ANCHOS) {
        for (const ruta of RUTAS) {
          await paso(page, `${ruta} a ${ancho} px`, async () => {
            await page.setViewportSize({ width: ancho, height: 900 })
            await page.goto(ruta)
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
            await page.waitForLoadState('networkidle')
            const medidas = await page.evaluate(() => {
              const raiz = document.documentElement
              const ancho = raiz.clientWidth
              const culpables = Array.from(document.querySelectorAll('body *'))
                .filter((e) => e.getBoundingClientRect().right > ancho + 1)
                .slice(0, 5)
                .map((e) => `${e.tagName}.${String(e.className).split(' ').slice(0, 2).join('.')}`)
              return { scrollWidth: raiz.scrollWidth, clientWidth: ancho, culpables }
            })
            expect(medidas.scrollWidth, `${ruta} a ${ancho} px desborda: ${medidas.culpables.join(', ')}`).toBeLessThanOrEqual(medidas.clientWidth)
          })
        }
      }
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (orgId) {
        await borrar(`${url}/rest/v1/usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`${url}/rest/v1/organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrar(`${url}/auth/v1/admin/users/${userId}`)
    }
  })

  test('axe a 320 px en listados con avisos y con el menú lateral abierto', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `desborde-axe-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      ;[{ id: orgId }] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E axe ${sufijo}` }])
      const alta = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
      if (!alta.ok) throw new Error(`alta de ${correo}: ${alta.status} ${await alta.text()}`)
      userId = ((await alta.json()) as { id: string }).id
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: orgId, rol_id: 'administrador' })

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, correo)
      await page.setViewportSize({ width: 320, height: 900 })
      for (const ruta of ['/ventas/comprobantes', '/proveedores', '/ventas/presupuestos', ...RUTAS]) {
        await paso(page, `axe en ${ruta} a 320 px`, async () => {
          await page.goto(ruta)
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
          await page.waitForLoadState('networkidle')
          expect(await violacionesAxe(page)).toEqual([])
        })
      }
      await paso(page, 'axe con el menú lateral abierto a 320 px', async () => {
        await page.goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await page.getByRole('button', { name: 'Abrir el menú lateral' }).click()
        await expect(page.getByRole('navigation', { name: 'Inicio' })).toBeVisible()
        expect(await violacionesAxe(page)).toEqual([])
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (orgId) {
        await borrar(`${url}/rest/v1/usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`${url}/rest/v1/organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrar(`${url}/auth/v1/admin/users/${userId}`)
    }
  })
})
