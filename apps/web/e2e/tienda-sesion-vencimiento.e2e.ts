import { expect, test } from './fixture'

// [MSF-673] Tienda pública: el primer clic de un visitante que vuelve tras más de 12 h lo mandaba
// a `/login` (ruta que la tienda no tiene → 404) y le cerraba la sesión. El control de vencimiento
// por inactividad es del panel: en un host de tienda no debe instalarse.
//
// El caso es de arranque (no necesita la base): la marca `sesion:ultima-actividad` se adelanta 13 h
// con un init script (corre antes que la app) y después se hace el primer clic del visitante.
// Si el build no define `VITE_PANEL_HOSTS`, este host se sirve como panel y el caso no aplica:
// el panel manda al ingreso solo, sin actividad, y el test se omite con ese motivo.
// Ver docs/tiendas-online.md y docs/acceso-ingreso.md.

const HOST_TIENDA = 'mundojc.localhost'
const CLAVE_ULTIMA_ACTIVIDAD = 'sesion:ultima-actividad'
const HORAS_POR_MS = 60 * 60 * 1000

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test('[MSF-673:MSF-673] en la tienda, tras más de 12 h sin actividad el primer clic no manda a /login ni cierra la sesión', async ({ page }) => {
  const marca = String(Date.now() - 13 * HORAS_POR_MS)
  await page.addInitScript(
    ([clave, valor]) => window.localStorage.setItem(clave, valor),
    [CLAVE_ULTIMA_ACTIVIDAD, marca],
  )

  // El cierre de sesión del panel pide un logout a Auth: se vigila para comprobar que no ocurre.
  const cierresDeSesion: string[] = []
  page.on('request', (peticion) => {
    if (peticion.url().includes('/auth/v1/logout')) cierresDeSesion.push(peticion.url())
  })

  await page.goto(`http://${HOST_TIENDA}:${puerto}/`)

  // El panel (sin sesión) manda a `/login` al cargar; la tienda no. Si aparece `/login`, este host
  // no se está sirviendo como tienda y el caso no aplica.
  await page.waitForTimeout(1000)
  test.skip(/\/login$/.test(new URL(page.url()).pathname), 'Este host no se sirve como tienda (falta VITE_PANEL_HOSTS en el build): el caso no aplica.')

  // El primer clic del visitante que vuelve al día siguiente.
  await page.mouse.click(4, 4)

  // Con el defecto, el clic cerraba la sesión y hacía `assign('/login')`: se espera a que esa
  // navegación ocurra (o a que la página quede quieta) antes de afirmar que no pasó.
  const redirigio = await Promise.race([
    page.waitForURL(/\/login(\?|$)/, { timeout: 4000 }).then(() => true, () => false),
    page.waitForTimeout(4000).then(() => false),
  ])

  expect(redirigio).toBe(false)
  expect(new URL(page.url()).pathname).not.toBe('/login')
  // La tienda no tiene 404 para `/login`: con el defecto el visitante veía «No encontramos esta página».
  await expect(page.getByTestId('pagina-no-encontrada')).toHaveCount(0)
  expect(cierresDeSesion).toEqual([])
})
