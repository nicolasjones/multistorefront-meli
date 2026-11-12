import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ANCHOS, desborde, ingresar, limpiar, sembrar, serviceKey, UUID, url, violacionesAxe, type Sembrado } from './ventas-faltantes-soporte'
import { clic, escribir, paso, prepararPaginaVisible } from './visible'

// F-VTA-26 (MSF-257 · épica MSF-161): avisar a los clientes con faltantes desde /ventas/faltantes.
// CA-VTA-26-1: dos faltantes con correo, se edita el texto, se envía y ambos quedan «Avisado» con fecha.
// CA-VTA-26-2: un cliente sin correo → «El cliente no tiene correo» y sin marca.
// SC-001 y SC-002: axe sin violaciones y sin desborde horizontal a 320, 768 y 1440 px, operable con teclado y
// sin identificadores técnicos visibles. Requiere el stack local (ver `ventas-faltantes-soporte.ts`).
test.describe('Ventas · avisos de faltantes (MSF-257, F-VTA-26)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-257:CA-VTA-26-1] elige dos faltantes con correo, edita el texto y los deja «Avisado» con fecha', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar('avisos', [
        { cliente: 'Ana Aviso', producto: 'Joystick Aviso', cantidad: 2, correo: 'ana.aviso@example.com' },
        { cliente: 'Beto Aviso', producto: 'Cable Aviso', cantidad: 1, correo: 'beto.aviso@example.com' },
      ])
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      await paso(page, 'Elige los dos faltantes y abre el diálogo', async () => {
        await page.goto('/ventas/faltantes')
        await expect(page.getByRole('heading', { name: 'Faltantes', level: 1 })).toBeVisible()
        await expect(page.getByText('Joystick Aviso')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
        await clic(page, page.getByRole('checkbox', { name: 'Seleccionar todos' }))
        await expect(page.getByText('2 seleccionados de 2 faltantes.')).toBeVisible()
        await clic(page, page.getByRole('button', { name: 'Avisar a los seleccionados (2)' }))
        await expect(page.getByRole('dialog', { name: 'Avisar a los clientes' })).toBeVisible()
      })

      await paso(page, 'Edita el texto y envía los avisos', async () => {
        const dialogo = page.getByRole('dialog', { name: 'Avisar a los clientes' })
        await escribir(page, dialogo.getByRole('textbox', { name: 'Texto del aviso' }), 'Ya llegó lo que pediste: pasá cuando quieras.')
        await clic(page, dialogo.getByRole('button', { name: 'Enviar avisos' }))
        await expect(page.getByText('Avisos enviados.')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      })

      await paso(page, 'Ambos faltantes quedan «Avisado» con fecha', async () => {
        await expect(page.getByText(/Avisado · \d{2}\/\d{2}\/\d{4}/)).toHaveCount(2)
        await expect(page.getByText('Sin avisar')).toHaveCount(0)
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })

  test('[MSF-257:CA-VTA-26-2] un cliente sin correo no se marca y se avisa «El cliente no tiene correo»', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar('sincorreo', [{ cliente: 'Carla Sincorreo', producto: 'Funda Sincorreo', cantidad: 1, correo: null }])
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)
      await page.goto('/ventas/faltantes')
      await expect(page.getByText('Funda Sincorreo')).toBeVisible()
      await clic(page, page.getByRole('checkbox', { name: /Seleccionar Funda Sincorreo/ }))
      await clic(page, page.getByRole('button', { name: 'Avisar a los seleccionados (1)' }))
      await clic(page, page.getByRole('dialog', { name: 'Avisar a los clientes' }).getByRole('button', { name: 'Enviar avisos' }))
      await expect(page.getByText('No se enviaron avisos. El cliente no tiene correo.')).toBeVisible()
      await expect(page.getByText('Sin avisar')).toBeVisible()
      await expect(page.getByText(/Avisado/)).toHaveCount(0)
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })

  test('[MSF-257:SC-001] sin violaciones de axe ni desborde a 320, 768 y 1440 px, con teclado y sin identificadores técnicos', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar('a11y', [
        { cliente: 'Dora A11y', producto: 'Teclado A11y', cantidad: 1, correo: 'dora.a11y@example.com' },
      ])
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      for (const ancho of ANCHOS) {
        await paso(page, `Revisa la pantalla a ${ancho} px`, async () => {
          await page.setViewportSize({ width: ancho, height: 900 })
          await page.goto('/ventas/faltantes')
          await expect(page.getByText('Teclado A11y')).toBeVisible()
          expect(await desborde(page)).toBeLessThanOrEqual(1)
          expect(await violacionesAxe(page)).toEqual([])
        })
      }

      await paso(page, 'Sin identificadores técnicos como identidad visible', async () => {
        expect(await page.locator('main').innerText()).not.toMatch(UUID)
      })

      await paso(page, 'Con teclado: abre el diálogo, lo cierra con Escape y el foco vuelve al botón', async () => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto('/ventas/faltantes')
        const casilla = page.getByRole('checkbox', { name: /Seleccionar Teclado A11y/ })
        await casilla.focus()
        await page.keyboard.press('Space')
        const boton = page.getByRole('button', { name: 'Avisar a los seleccionados (1)' })
        await boton.focus()
        await page.keyboard.press('Enter')
        const dialogo = page.getByRole('dialog', { name: 'Avisar a los clientes' })
        await expect(dialogo).toBeVisible()
        expect(await violacionesAxe(page)).toEqual([])
        await page.keyboard.press('Escape')
        await expect(dialogo).toHaveCount(0)
        await expect(boton).toBeFocused()
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })
})
