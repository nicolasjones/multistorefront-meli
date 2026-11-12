import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { ingresar, serviceKey, url, violacionesAxe } from './importaciones-soporte'
import { clic, paso, prepararPaginaVisible } from './visible'

// F-NOT-02 (MSF-378 · T010 · SC-002): la campanita muestra el punto y la lista de avisos propios, un aviso
// abierto queda leído, «Marcar todas» apaga el punto y otra persona no ve avisos ajenos. Siembra con la
// API admin desde Node (la service-role key nunca llega al navegador); solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de notificaciones: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const password = 'Correcta-12345!'
const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'POST', headers: cabeceras({ prefer: 'return=representation' }), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

test.describe('Centro de notificaciones en el panel (MSF-378)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

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
      await rest('avisos_pendientes', ['Ana', 'Beto', 'Cami'].map((nombre, i) => ({
        organizacion_id: orgId,
        user_id: usuarios[0],
        tipo_aviso: 'consulta_nueva',
        grupo_id: randomUUID(),
        datos: { Nombre: `${nombre} ${sufijo}`, Producto: 'Remera' },
        creado_en: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      })))

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
        await expect(sesionOtra.page.getByText(new RegExp(`Nombre: (Ana|Beto|Cami) ${sufijo}`))).toHaveCount(0)
      })
    } finally {
      await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      await cerrarContextoGrabado(sesionOtra.contexto, sesionOtra.page, testInfo)
      if (orgId) {
        await fetch(`${url}/rest/v1/avisos_pendientes?organizacion_id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
        await fetch(`${url}/rest/v1/usuarios_organizacion?organizacion_id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
        await fetch(`${url}/rest/v1/organizaciones?id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
      }
      for (const id of usuarios) await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
    }
  })
})
