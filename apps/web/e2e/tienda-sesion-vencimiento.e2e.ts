import { expect, test } from './fixture'

// [MSF-740] Tienda pública: la regla de inactividad de sesión es del PANEL (12 h sin actividad → cierre de
// sesión y vuelta a `/login`). La tienda NO la hereda: la sesión de un cliente con cuenta web termina solo por
// salida explícita («Salir» de la tienda) o por el tope de 30 días del servidor.
//
// Antes de MSF-740 la tienda heredaba esa ventana: el primer clic de un visitante que volvía tras más de 12 h
// cerraba su sesión local y lo mandaba a `/` —y como la marca vencida no se renueva ni se borra, cada clic
// posterior lo volvía a llevar a la portada (bucle de recargas). El caso adelanta la marca
// `sesion:ultima-actividad` 13 h con un init script (corre antes que la app) y comprueba que, en un host de
// tienda, ese primer clic NO cierra la sesión ni redirige a ninguna parte.
//
// Se conservan las garantías de MSF-673: nunca `/login` (ruta que la tienda no tiene), nunca 404 y nunca
// revocación global. Si el build no define `VITE_PANEL_HOSTS`, este host se sirve como panel y el caso no
// aplica: el panel manda al ingreso solo, sin actividad, y el test se omite con ese motivo.
// Ver docs/tiendas-online.md y docs/acceso-ingreso.md.

const HOST_TIENDA = 'mundojc.localhost'
const CLAVE_ULTIMA_ACTIVIDAD = 'sesion:ultima-actividad'
const HORAS_POR_MS = 60 * 60 * 1000

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test('[MSF-740:MSF-740] en la tienda, tras más de 12 h sin actividad el primer clic no cierra la sesión ni redirige', async ({ page }) => {
  const marca = String(Date.now() - 13 * HORAS_POR_MS)
  await page.addInitScript(
    ([clave, valor]) => window.localStorage.setItem(clave, valor),
    [CLAVE_ULTIMA_ACTIVIDAD, marca],
  )

  // `authProvider.logout` (panel) revoca la sesión en todos los dispositivos. En la tienda no hay cierre por
  // inactividad: no debe haber ningún pedido de cierre, y menos uno global.
  const cierres: string[] = []
  const revocacionesGlobales: string[] = []
  page.on('request', (peticion) => {
    const url = peticion.url()
    if (!url.includes('/auth/v1/logout')) return
    cierres.push(url)
    if (!url.includes('scope=local')) revocacionesGlobales.push(url)
  })

  await page.goto(`http://${HOST_TIENDA}:${puerto}/ingresar`)

  // El panel (sin sesión) manda a `/login` al cargar; la tienda no. Si aparece `/login`, este host
  // no se está sirviendo como tienda y el caso no aplica. En el job `e2e-tienda` (`E2E_TIENDA_CI=1`) NO se omite: arma el build con
  // `VITE_PANEL_HOSTS`, y si faltara tiene que fallar en vez de dar un falso verde.
  await page.waitForTimeout(1000)
  const sirveComoPanel = /\/login$/.test(new URL(page.url()).pathname)
  if (process.env.E2E_TIENDA_CI === '1') expect(sirveComoPanel, 'El build no define VITE_PANEL_HOSTS: el host no se sirve como tienda').toBe(false)
  test.skip(sirveComoPanel, 'Este host no se sirve como tienda (falta VITE_PANEL_HOSTS en el build): el caso no aplica.')

  // La página de ingreso tiene que estar montada: si la tienda no se resolvió, el caso no probaría nada.
  const tituloIngreso = page.getByRole('heading', { name: 'Ingresar' })
  await expect(tituloIngreso).toBeVisible()

  // El primer clic del visitante que vuelve al día siguiente, sobre el título (no es un enlace).
  await tituloIngreso.click()

  // La tienda no aplica la regla del panel: el visitante se queda donde está (antes lo mandaban a `/`).
  const navego = await page
    .waitForURL((url) => url.pathname !== '/ingresar', { timeout: 5000 })
    .then(() => true, () => false)

  expect(navego, 'la tienda no aplica la regla de inactividad del panel: el visitante no debe ser redirigido').toBe(false)
  expect(new URL(page.url()).pathname).toBe('/ingresar')
  // La tienda no tiene 404 para `/login`: con el defecto el visitante veía «No encontramos esta página».
  await expect(page.getByTestId('pagina-no-encontrada')).toHaveCount(0)
  expect(cierres).toEqual([])
  expect(revocacionesGlobales).toEqual([])
})
