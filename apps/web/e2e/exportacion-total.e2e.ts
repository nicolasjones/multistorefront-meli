import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, limpiar, serviceKey, sembrar, url, violacionesAxe, type Sembrado } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible, rotulo } from './visible'

// Cierre de F-OPS-06 (MSF-396 · T028 · SC-006): el administrador pide la exportación total, ve el avance en el
// centro y descarga el ZIP; un administrador de otra organización no accede y quien no administra no ve el bloque.
// El worker no corre en este E2E: la siembra hace de worker (cierra el proceso y sube el ZIP al bucket).
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.
test.describe('Exportar todos los datos (MSF-396)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  const cabeceras = (extra: Record<string, string> = {}) => ({ apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, ...extra })

  async function rest(ruta: string, metodo: string, cuerpo?: unknown) {
    const r = await fetch(`${url}/rest/v1/${ruta}`, {
      method: metodo,
      headers: cabeceras({ 'content-type': 'application/json', prefer: 'return=representation' }),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    if (!r.ok) throw new Error(`REST ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
    return (await r.json()) as Record<string, unknown>[]
  }

  async function altaUsuario(correo: string): Promise<string> {
    const r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: cabeceras({ 'content-type': 'application/json' }),
      body: JSON.stringify({ email: correo, password: 'Correcta-12345!', email_confirm: true }),
    })
    if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
    return ((await r.json()) as { id: string }).id
  }

  // Organización con conexión de exportaciones (`historial-ventas`), como la deja un administrador de la plataforma.
  async function conexionExportaciones(orgId: string) {
    await rest('conexiones', 'POST', { organizacion_id: orgId, sistema_externo: 'historial-ventas', credencial_vault_id: randomUUID() })
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
      await rest('usuarios_organizacion', 'POST', { user_id: idConsulta, organizacion_id: datos.orgId, rol_id: 'consulta' })

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
      const [proceso] = await rest(`procesos_masivos?organizacion_id=eq.${datos.orgId}&funcionalidad=eq.exportacion_total&select=id,ejecucion_id`, 'GET')
      const ruta = `${datos.orgId}/${String(proceso.ejecucion_id)}.zip`
      const subida = await fetch(`${url}/storage/v1/object/exportaciones-organizacion/${ruta}`, {
        method: 'POST',
        headers: cabeceras({ 'content-type': 'application/zip' }),
        body: Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary'),
      })
      if (!subida.ok) throw new Error(`subida del ZIP: ${subida.status} ${await subida.text()}`)
      await rest(`procesos_masivos?id=eq.${String(proceso.id)}`, 'PATCH', { estado: 'completado', total: 3, procesados: 3, finalizado_en: new Date().toISOString() })

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
        await page.evaluate(() => window.localStorage.clear())
        await ingresar(page, otra!.correo)
        await page.goto('/importaciones')
        const bloque = page.getByRole('region', { name: 'Exportar todos los datos' })
        await expect(bloque.getByText('Todavía no pediste una exportación total.')).toBeVisible()
        await expect(bloque.getByRole('button', { name: 'Descargar' })).toHaveCount(0)
      })

      await paso(page, 'Quien no administra no ve el bloque', async () => {
        await sesion.contexto.clearCookies()
        await page.evaluate(() => window.localStorage.clear())
        await ingresar(page, correoSinPermiso)
        await page.goto('/importaciones')
        await expect(page.getByRole('heading', { name: 'Importaciones', level: 1 })).toBeVisible()
        await expect(page.getByRole('region', { name: 'Exportar todos los datos' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Exportar todos los datos' })).toHaveCount(0)
      })
      await rotulo(page, 'La exportación total es solo de administradores y de su organización')
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      if (datos) {
        await fetch(`${url}/storage/v1/object/exportaciones-organizacion`, {
          method: 'DELETE',
          headers: cabeceras({ 'content-type': 'application/json' }),
          body: JSON.stringify({ prefixes: [`${datos.orgId}/`] }),
        }).catch(() => undefined)
        await fetch(`${url}/rest/v1/capacidades_ejecucion?organizacion_id=eq.${datos.orgId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
        await fetch(`${url}/rest/v1/conexiones?organizacion_id=eq.${datos.orgId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
        datos.idsUsuario.push(...extras)
        await limpiar(datos)
      }
      if (otra) await limpiar(otra)
    }
  })
})
