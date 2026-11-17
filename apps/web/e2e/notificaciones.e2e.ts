import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, serviceKey, url, violacionesAxe } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible } from './visible'
import { altaUsuario, borrar, borrarUsuario, rest, sql } from './soporte/fixtures'

// F-NOT-02 (MSF-378 · T010 · SC-002): la campanita muestra el punto y la lista de avisos propios, un aviso
// abierto queda leído, «Marcar todas» apaga el punto y otra persona no ve avisos ajenos. Siembra con la
// API admin desde Node (la service-role key nunca llega al navegador); solo contra un Supabase local.

test.describe('Centro de notificaciones en el panel (MSF-378)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Sin tope por acción, un elemento que no aparece (clic, `boundingBox`, `fill`) deja el test colgado hasta su timeout de 5 min y
  // oculta el fallo real; con tope falla en 30 s señalando la acción.
  test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 })

  test('[MSF-378:T010] punto, lista, abrir un aviso, marcar todas y aislamiento entre personas', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const sufijo = randomUUID().slice(0, 8)
    const correos = { quien: `notif-${sufijo}@example.com`, otra: `notif-otra-${sufijo}@example.com` }
    const usuarios: string[] = []
    let orgId: string | undefined
    const sesion = await abrirContextoGrabado(browser, testInfo)
    const sesionOtra = await abrirContextoGrabado(browser, testInfo, 'otra')
    try {
      ;[{ id: orgId }] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E notificaciones ${sufijo}` }])
      for (const correo of Object.values(correos)) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', { user_id: id, organizacion_id: orgId, rol_id: 'administrador' })
      }
      // `service_role` no tiene grant sobre `public.avisos_pendientes` (la REST daría 42501): se siembra por `sql()`.
      for (const [i, nombre] of ['Ana', 'Beto', 'Cami'].entries()) {
        await sql(
          'insert into public.avisos_pendientes (organizacion_id, user_id, tipo_aviso, grupo_id, datos, creado_en) values ($1, $2, $3, $4, $5::jsonb, $6)',
          [orgId, usuarios[0], 'consulta_nueva', randomUUID(), JSON.stringify({ Nombre: `${nombre} ${sufijo}`, Producto: 'Remera' }), new Date(Date.now() - (i + 1) * 60_000).toISOString()],
        )
      }

      const { page } = sesion
      await prepararPaginaVisible(page)
      await ingresar(page, correos.quien)

      await paso(page, 'Ve el punto con tres avisos sin leer', async () => {
        await expect(page.getByRole('button', { name: 'Notificaciones, 3 sin leer' })).toBeVisible()
        await clic(page, page.getByRole('button', { name: 'Notificaciones, 3 sin leer' }))
        await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeVisible()
        await expect(page.getByText(`Nombre: Ana ${sufijo}`)).toBeVisible()
        expect(await violacionesAxe(page)).toEqual([])
      })

      await paso(page, 'Abre un aviso y queda leído', async () => {
        await clic(page, page.getByText(`Nombre: Ana ${sufijo}`))
        // Con la lista abierta (modal) la campanita queda fuera del árbol accesible: se cuentan los avisos sin leer de la lista.
        await expect(page.getByRole('button', { name: /^Consulta nueva \(sin leer\)/ })).toHaveCount(2)
        await expect(page.getByRole('button', { name: new RegExp(`^Consulta nueva Nombre: Ana ${sufijo}`) })).toBeVisible()
        // Y el contador de la campanita, ya sin el modal, baja de 3 a 2.
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeHidden()
        await expect(page.getByRole('button', { name: 'Notificaciones, 2 sin leer' })).toBeVisible()
        await clic(page, page.getByRole('button', { name: 'Notificaciones, 2 sin leer' }))
        await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeVisible()
      })

      await paso(page, 'Marca todas como leídas', async () => {
        await clic(page, page.getByRole('button', { name: 'Marcar todas como leídas' }))
        await expect(page.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled()
        await expect(page.getByRole('button', { name: /\(sin leer\)/ })).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeHidden()
        // Cerrada la lista, la campanita vuelve sin contador.
        await expect(page.getByRole('button', { name: 'Notificaciones', exact: true })).toBeVisible()
      })

      await paso(sesionOtra.page, 'Otra persona no ve avisos ajenos', async () => {
        await prepararPaginaVisible(sesionOtra.page)
        await ingresar(sesionOtra.page, correos.otra)
        await clic(sesionOtra.page, sesionOtra.page.getByRole('button', { name: 'Notificaciones', exact: true }))
        await expect(sesionOtra.page.getByText('No tenés notificaciones.')).toBeVisible()
        // El sufijo solo no sirve: también está en el nombre de la organización y en el correo, que la pantalla muestra.
        await expect(sesionOtra.page.getByText(new RegExp(`Nombre: (Ana|Beto|Cami) ${sufijo}`))).toHaveCount(0)
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      await cerrarContextoGrabado(sesionOtra.contexto, sesionOtra.page, testInfo)
      if (orgId) {
        await sql('delete from public.avisos_pendientes where organizacion_id = $1', [orgId]).catch((e) => console.warn(`limpieza E2E: avisos_pendientes → ${(e as Error).message}`))
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
