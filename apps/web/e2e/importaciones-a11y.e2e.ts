import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, limpiar, serviceKey, sembrar, url, violacionesAxe, type Sembrado } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible } from './visible'

// F-IMP-01 (MSF-354 · T013 · FR-016): el centro es operable a 320, 768 y 1440 px, con teclado y sin
// identificadores técnicos visibles. Mismo stack y siembra que `importaciones.e2e.ts`.
const ANCHOS = [320, 768, 1440]

test.describe('Centro de importaciones: accesibilidad y responsive (MSF-354)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-354:T013] sin violaciones de axe a 320, 768 y 1440 px, con teclado y sin identificadores técnicos', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar(sufijo)
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      for (const ancho of ANCHOS) {
        await paso(page, `Revisa el centro a ${ancho} px`, async () => {
          await page.setViewportSize({ width: ancho, height: 900 })
          await page.goto('/importaciones')
          await expect(page.getByRole('heading', { name: 'Importaciones', level: 1 })).toBeVisible()
          await expect(page.getByText(datos!.nombres.con_errores)).toBeVisible()
          // Sin desborde horizontal de la página.
          const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          expect(desborde).toBeLessThanOrEqual(1)
          expect(await violacionesAxe(page)).toEqual([])
        })
      }

      await paso(page, 'Sin identificadores técnicos como identidad visible', async () => {
        const texto = await page.locator('main').innerText()
        expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
        expect(texto).not.toContain('mercado-libre')
        expect(texto).not.toContain('exportacion-total')
        expect(texto).toContain('Mercado Libre')
      })

      await paso(page, 'Con teclado: abre el detalle, lo cierra con Escape y el foco vuelve al botón', async () => {
        await page.setViewportSize({ width: 1440, height: 900 })
        const boton = page.getByRole('button', { name: `Ver detalle de ${datos!.nombres.con_errores}` })
        await boton.focus()
        await page.keyboard.press('Enter')
        const dialogo = page.getByRole('dialog', { name: 'Detalle de la importación' })
        await expect(dialogo).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialogo).toHaveCount(0)
        await expect(boton).toBeFocused()
      })

      await paso(page, 'Con teclado: el diálogo de cancelación se opera sin mouse', async () => {
        await clic(page, page.getByRole('button', { name: `Cancelar ${datos!.nombres.pendiente}` }))
        const confirmacion = page.getByRole('dialog', { name: '¿Cancelar este proceso?' })
        await expect(confirmacion).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(confirmacion).toHaveCount(0)
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })
})
