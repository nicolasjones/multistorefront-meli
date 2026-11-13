import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ANCHOS, desborde, ingresar, leer, limpiar, sembrar, serviceKey, url, violacionesAxe, type Sembrado } from './ventas-faltantes-soporte'
import { clic, escribir, paso, prepararPaginaVisible } from './visible'

// F-VTA-27 (MSF-270 · épica MSF-161): «Para avisar» al ingresar mercadería.
// CA-VTA-27-1: un producto con 3 faltantes abiertos, un ingreso de 10 unidades registrado por la pantalla de
// Ingreso de mercadería → los 3 aparecen en «Para avisar» y no se envió ningún aviso.
// SC-101: axe sin violaciones a 320, 768 y 1440 px con el filtro «Para avisar». Requiere el stack local.
test.describe('Ventas · «Para avisar» al ingresar mercadería (MSF-270, F-VTA-27)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-270:CA-VTA-27-1] el ingreso de 10 deja los 3 faltantes «Para avisar» sin enviar avisos y sin violaciones de axe', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      const producto = 'Joystick Para avisar'
      datos = await sembrar('paraavisar', [
        { cliente: 'Eva Para', producto, cantidad: 3, correo: 'eva.para@example.com' },
        { cliente: 'Fede Para', producto, cantidad: 3, correo: 'fede.para@example.com' },
        { cliente: 'Gina Para', producto, cantidad: 3, correo: 'gina.para@example.com' },
      ])
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      await paso(page, 'Registra un ingreso de 10 unidades por Ingreso de mercadería', async () => {
        await page.goto('/stock/ingresos')
        await page.getByLabel('Compra a nombre de').click()
        await clic(page, page.getByRole('option', { name: datos!.empresa }))
        await page.locator('form').getByLabel('Proveedor').click()
        await clic(page, page.getByRole('option', { name: datos!.proveedor }))
        await page.locator('form').getByRole('combobox', { name: 'Producto 1', exact: true }).click()
        await clic(page, page.getByRole('option', { name: producto }))
        await escribir(page, page.getByLabel('Cantidad').first(), '10')
        await escribir(page, page.getByLabel('Costo unit. USD').first(), '10')
        await clic(page, page.getByRole('button', { name: 'Registrar ingreso' }))
        await expect(page.getByText(/Ingreso registrado · 10 unidades/)).toBeVisible()
      })

      await paso(page, 'Los 3 faltantes aparecen en «Para avisar»', async () => {
        await page.goto('/ventas/faltantes')
        await expect(page.getByText('3 faltantes', { exact: true })).toBeVisible()
        await clic(page, page.getByRole('button', { name: 'Para avisar' }))
        await expect(page.getByRole('note')).toBeVisible()
        await expect(page.getByText('3 faltantes', { exact: true })).toBeVisible()
        await expect(page.getByText('Para avisar', { exact: true })).toHaveCount(4) // el botón del filtro y 3 chips
      })

      await paso(page, 'No se envió ningún aviso', async () => {
        const avisos = await leer<{ linea_id: string }>(`faltantes_avisos?select=linea_id&organizacion_id=eq.${datos!.orgId}`)
        expect(avisos).toHaveLength(0)
      })

      for (const ancho of ANCHOS) {
        await paso(page, `Revisa «Para avisar» a ${ancho} px`, async () => {
          await page.setViewportSize({ width: ancho, height: 900 })
          await page.goto('/ventas/faltantes')
          await clic(page, page.getByRole('button', { name: 'Para avisar' }))
          await expect(page.getByRole('note')).toBeVisible()
          expect(await desborde(page), `desborde horizontal a ${ancho} px`).toBeLessThanOrEqual(1)
          expect(await violacionesAxe(page)).toEqual([])
        })
      }
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })
})
