import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, limpiar, serviceKey, sembrar, url, violacionesAxe, type Sembrado } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible, rotulo } from './visible'

// Cierre de F-IMP-01 (MSF-354 · T014 · SC-001, SC-002, SC-007): el centro de importaciones con un proceso
// creado por las funciones de la base, el avance visible, los errores en el detalle, la cancelación y el
// cambio de empresa. Requiere el stack local (`pnpm dev:supabase`) y la web servida; sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público). Ver docs/e2e-app.md.
test.describe('Centro de importaciones y exportaciones (MSF-354)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-354:T014] ver avance y errores, cancelar un proceso y cambiar de empresa, sin violaciones de accesibilidad', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar(sufijo)
      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      await paso(page, 'Abre Importaciones desde la navegación', async () => {
        await page.goto('/importaciones')
        await expect(page.getByRole('heading', { name: 'Importaciones', level: 1 })).toBeVisible()
        await expect(page.getByRole('table', { name: 'Importaciones y exportaciones' })).toBeVisible()
      })

      await paso(page, 'Ve el proceso pendiente y el que está en curso con su avance', async () => {
        const tabla = page.getByRole('table', { name: 'Importaciones y exportaciones' })
        await expect(tabla.getByRole('row', { name: new RegExp(datos!.nombres.pendiente) })).toContainText('Pendiente')
        const enCurso = tabla.getByRole('row', { name: new RegExp(datos!.nombres.en_curso) })
        await expect(enCurso).toContainText('En curso')
        await expect(enCurso).toContainText('40 de 100')
      })

      await paso(page, 'Sin violaciones de accesibilidad en la tabla', async () => {
        expect(await violacionesAxe(page)).toEqual([])
      })

      await paso(page, 'El detalle del proceso con errores muestra fila, referencia y motivo', async () => {
        await clic(page, page.getByRole('button', { name: `Ver detalle de ${datos!.nombres.con_errores}` }))
        const dialogo = page.getByRole('dialog', { name: 'Detalle de la importación' })
        await expect(dialogo.getByRole('cell', { name: 'MLA-100' })).toBeVisible()
        await expect(dialogo.getByRole('cell', { name: 'Precio inválido' })).toBeVisible()
        await expect(dialogo.getByRole('cell', { name: 'Falta el título' })).toBeVisible()
        expect(await violacionesAxe(page)).toEqual([])
        await clic(page, dialogo.getByRole('button', { name: 'Cerrar' }))
        await expect(dialogo).toHaveCount(0)
      })

      await paso(page, 'Cancela el proceso pendiente con confirmación', async () => {
        await clic(page, page.getByRole('button', { name: `Cancelar ${datos!.nombres.pendiente}` }))
        const confirmacion = page.getByRole('dialog', { name: '¿Cancelar este proceso?' })
        await clic(page, confirmacion.getByRole('button', { name: 'Sí, cancelar el proceso' }))
        const fila = page.getByRole('row', { name: new RegExp(datos!.nombres.pendiente) })
        await expect(fila).toContainText('Cancelado')
        await expect(page.getByRole('button', { name: `Cancelar ${datos!.nombres.pendiente}` })).toHaveCount(0)
      })

      await paso(page, 'Cambia a la Tienda B: solo se ven sus procesos', async () => {
        await clic(page, page.getByRole('button', { name: /^Empresa activa:/ }))
        await clic(page, page.getByRole('menuitem', { name: new RegExp(datos!.empresaB.nombre) }))
        await expect(page.getByRole('row', { name: new RegExp(datos!.nombres.en_curso) })).toBeVisible()
        await expect(page.getByRole('row', { name: new RegExp(datos!.nombres.pendiente) })).toHaveCount(0)
        await expect(page.getByRole('row', { name: new RegExp(datos!.nombres.con_errores) })).toHaveCount(0)
      })
      await rotulo(page, 'El centro sigue la empresa activa y sin datos de la anterior')
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) await limpiar(datos)
    }
  })
})
