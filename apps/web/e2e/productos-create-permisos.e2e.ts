import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, limpiar, serviceKey, sembrar, url, type Sembrado } from './importaciones-soporte'
import { paso, prepararPaginaVisible } from './visible'

// Alta de producto y permisos (hallazgo de la revisión E2E: «Nombre» quedaba vacío, «Faltan datos obligatorios»).
// 1) Con permisos y organización llegando tarde, el formulario se monta una sola vez y lo tipeado en cuanto aparece
//    se conserva (el nodo marcado sigue siendo el mismo). Guardia de regresión: el simple «escribir enseguida» NO
//    reprodujo la pérdida en el stack local (ver el PR); no es una prueba que falle sin arreglo.
// 2) Seguridad: si el repedido de permisos falla con el formulario abierto, la UI NO sigue ofreciendo guardar: falla
//    cerrada («No pudimos verificar tus permisos»). La prueba protege contra conservar el nivel anterior, que dejaría
//    abierto el formulario con el permiso ya perdido.
// Mismo stack y siembra que `importaciones.e2e.ts`; se omite sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
test.describe('Alta de producto: permisos que llegan tarde o fallan', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-499:T-create] guardia de regresión (no detecta el bug: no reproducido): con permisos y organización tardíos el formulario se monta una vez', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar(randomUUID().slice(0, 8))
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)
      for (const rpc of ['contexto_panel_actual', 'permisos_actuales']) {
        await page.route(`**/rest/v1/rpc/${rpc}*`, async (ruta) => {
          await new Promise((resolver) => setTimeout(resolver, 1500))
          await ruta.continue()
        })
      }
      const permisos = page.waitForResponse((r) => r.url().includes('/rpc/permisos_actuales'))
      await paso(page, 'Abre el alta y escribe en «Nombre» apenas aparece', async () => {
        await page.goto('/productos/create')
        const nombre = page.getByLabel(/^Nombre/)
        await expect(nombre).toBeVisible({ timeout: 60_000 })
        await nombre.fill('Joystick inalámbrico')
        await nombre.evaluate((el) => el.setAttribute('data-e2e-marca', 'montado-una-vez'))
      })
      await paso(page, 'Termina toda la carga y el campo sigue siendo el mismo nodo con su texto', async () => {
        await permisos
        await page.waitForLoadState('networkidle')
        const nombre = page.getByLabel(/^Nombre/)
        await expect(nombre).toHaveValue('Joystick inalámbrico')
        await expect(nombre).toHaveAttribute('data-e2e-marca', 'montado-una-vez')
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })

  test('[MSF-499:T-create] si el repedido de permisos falla con el formulario abierto, no se ofrece guardar', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar(randomUUID().slice(0, 8))
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)
      let fallar = false
      await page.route('**/rest/v1/rpc/permisos_actuales*', async (ruta) => (fallar ? ruta.abort() : ruta.continue()))

      await page.goto('/productos/create')
      await page.getByLabel(/^Nombre/).fill('Joystick inalámbrico')
      await expect(page.getByRole('button', { name: 'Crear producto' })).toBeVisible()

      await paso(page, 'Cambia la empresa activa: los permisos se vuelven a pedir y el pedido falla', async () => {
        fallar = true
        const caido = page.waitForEvent('requestfailed', (r) => r.url().includes('/rpc/permisos_actuales'))
        await page.getByRole('button', { name: /^Empresa activa:/ }).click()
        await page.getByRole('menuitem', { name: new RegExp(datos!.empresaA.nombre) }).click()
        // El diálogo «¿Cambiar de empresa?» solo sale si la pantalla se declaró con cambios sin guardar: se espera lo que
        // ocurra primero (el diálogo, que se confirma, o el pedido de permisos ya caído) sin pausas fijas.
        const confirmar = page.getByRole('button', { name: 'Cambiar igual' })
        await Promise.race([confirmar.waitFor({ state: 'visible' }).then(() => confirmar.click()).catch(() => undefined), caido])
        await caido
      })

      await paso(page, 'La pantalla falla cerrada: avisa y ya no ofrece guardar ni editar', async () => {
        await expect(page.getByText('No pudimos verificar tus permisos.').first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Crear producto' })).toHaveCount(0)
        await expect(page.getByLabel(/^Nombre/)).toHaveCount(0)
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })
})
