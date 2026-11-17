import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { conexionDe, ingresar, limpiar, serviceKey, sembrar, sistemaExterno, url, violacionesAxe, type Sembrado } from './importaciones-soporte'
import { altaUsuario, cabeceras, rest, sql } from './soporte/fixtures'
import { clic, paso, prepararPaginaVisible, rotulo } from './visible'

// Cierre de F-OPS-06 (MSF-396 · T028 · SC-006): el administrador pide la exportación total, ve el avance en el
// centro y descarga el ZIP; un administrador de otra organización no accede y quien no administra no ve el bloque.
// El worker no corre en este E2E: la siembra hace de worker (cierra el proceso y sube el ZIP al bucket).
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.
test.describe('Exportar todos los datos (MSF-396)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Sin tope por acción, un elemento que no aparece (clic, `boundingBox`, `fill`) deja el test colgado hasta su timeout de 5 min y
  // oculta el fallo real; con tope falla en 30 s señalando la acción.
  test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 })

  // `service_role` no tiene grant sobre `conexiones`, `sistemas_externos` ni `procesos_masivos` (la REST daría 42501): se siembran
  // por `sql()` (solo siembra; lo que se VERIFICA se mira en la pantalla). La conexión de exportaciones (`historial-ventas`)
  // la deja un administrador de la plataforma; el esquema no trae la referencia, se siembra sin pisar la existente.
  async function conexionExportaciones(orgId: string) {
    await sistemaExterno('historial-ventas', 'Historial de ventas (exportaciones de la organización)')
    await conexionDe(orgId, 'historial-ventas')
  }

  test('[MSF-396:T028] pedir, ver el avance, descargar el ZIP y respetar los permisos, sin violaciones de accesibilidad', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    let otra: Sembrado | undefined
    const extras: string[] = []
    const sesion = await abrirContextoGrabado(browser, testInfo)
    try {
      datos = await sembrar(sufijo)
      otra = await sembrar(`${sufijo}o`)
      await conexionExportaciones(datos.orgId)
      const correoSinPermiso = `consulta-exp-${sufijo}@example.com`
      const idConsulta = await altaUsuario(correoSinPermiso)
      extras.push(idConsulta)
      await rest('usuarios_organizacion', { user_id: idConsulta, organizacion_id: datos.orgId, rol_id: 'consulta' })

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)

      await paso(page, 'Ve el bloque «Exportar todos los datos» en Importaciones', async () => {
        await page.goto('/importaciones')
        await expect(page.getByRole('region', { name: 'Exportar todos los datos' })).toBeVisible()
        expect(await violacionesAxe(page)).toEqual([])
      })

      await paso(page, 'Pide la exportación y confirma', async () => {
        await clic(page, page.getByRole('button', { name: 'Exportar todos los datos' }))
        const dialogo = page.getByRole('dialog', { name: '¿Exportar todos los datos de la organización?' })
        expect(await violacionesAxe(page)).toEqual([])
        await clic(page, dialogo.getByRole('button', { name: 'Sí, exportar' }))
        await expect(dialogo).toHaveCount(0)
      })

      await paso(page, 'Ve el avance en el bloque y el proceso en el centro', async () => {
        const bloque = page.getByRole('region', { name: 'Exportar todos los datos' })
        await expect(bloque.getByText('Estamos preparando tu exportación.')).toBeVisible()
        await expect(bloque.getByRole('button', { name: 'Exportación en curso' })).toBeDisabled()
        await expect(page.getByRole('row', { name: /Exportación total de datos/ })).toBeVisible()
      })

      // La siembra hace de worker: sube el ZIP al bucket y cierra el proceso.
      const [proceso] = await sql<{ id: string; ejecucion_id: string }>("select id, ejecucion_id from public.procesos_masivos where organizacion_id = $1 and funcionalidad = 'exportacion_total'", [datos.orgId])
      const ruta = `${datos.orgId}/${proceso.ejecucion_id}.zip`
      const subida = await fetch(`${url}/storage/v1/object/exportaciones-organizacion/${ruta}`, {
        method: 'POST',
        headers: cabeceras({ 'content-type': 'application/zip' }),
        signal: AbortSignal.timeout(30_000),
        body: Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary'),
      })
      if (!subida.ok) throw new Error(`subida del ZIP: ${subida.status} ${await subida.text()}`)
      await sql("update public.procesos_masivos set estado = 'completado', total = 3, procesados = 3, finalizado_en = now() where id = $1", [proceso.id])

      await paso(page, 'Descarga el ZIP cuando termina', async () => {
        await page.reload()
        const bloque = page.getByRole('region', { name: 'Exportar todos los datos' })
        await expect(bloque.getByText('Tu exportación está lista.')).toBeVisible()
        const descarga = page.waitForEvent('download')
        await clic(page, bloque.getByRole('button', { name: 'Descargar' }))
        expect((await descarga).suggestedFilename()).toMatch(/^exportacion-total-\d{4}-\d{2}-\d{2}\.zip$/)
        expect(await violacionesAxe(page)).toEqual([])
      })

      await paso(page, 'Un administrador de otra organización no ve esa exportación ni su archivo', async () => {
        await sesion.contexto.clearCookies()
        await page.evaluate(() => {
          // La sesión vive en sessionStorage salvo que se marque «Mantener la sesión iniciada»: se limpian las dos.
          window.localStorage.clear()
          window.sessionStorage.clear()
        })
        await ingresar(page, otra!.correo)
        await page.goto('/importaciones')
        const bloque = page.getByRole('region', { name: 'Exportar todos los datos' })
        await expect(bloque.getByText('Todavía no pediste una exportación total.')).toBeVisible()
        await expect(bloque.getByRole('button', { name: 'Descargar' })).toHaveCount(0)
      })

      await paso(page, 'Quien no administra no ve el bloque', async () => {
        await sesion.contexto.clearCookies()
        await page.evaluate(() => {
          // La sesión vive en sessionStorage salvo que se marque «Mantener la sesión iniciada»: se limpian las dos.
          window.localStorage.clear()
          window.sessionStorage.clear()
        })
        await ingresar(page, correoSinPermiso)
        await page.goto('/importaciones')
        // Quien no administra ve el aviso de acceso restringido en lugar de la pantalla.
        await expect(page.getByRole('alert')).toContainText('Solo un administrador de la organización puede ver las importaciones y exportaciones.')
        await expect(page.getByRole('region', { name: 'Exportar todos los datos' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Exportar todos los datos' })).toHaveCount(0)
      })
      await rotulo(page, 'La exportación total es solo de administradores y de su organización')
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) {
        await fetch(`${url}/storage/v1/object/exportaciones-organizacion`, {
          method: 'DELETE',
          headers: cabeceras(),
          body: JSON.stringify({ prefixes: [`${datos.orgId}/`] }),
        }).catch(() => undefined)
        datos.idsUsuario.push(...extras)
        await limpiar(datos)
      }
      if (otra) await limpiar(otra)
    }
  })
})
