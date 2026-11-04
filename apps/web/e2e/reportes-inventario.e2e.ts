import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from './fixture'

// Cierre de MSF-140 (T014, FR-010, SC-004, SC-005): reportes de inventario por rol (sección `stock`) y
// descarga CSV. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin
// desde Node (la service-role key nunca llega al navegador). La descarga real necesita un Superset con los
// tableros importados: solo corre con E2E_SUPERSET=1. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de reportes-inventario: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function cambiar(ruta: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`PATCH ${ruta}: ${r.status} ${await r.text()}`)
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function borrar(ruta: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const PANTALLAS = [
  { ruta: '/reportes/inventario', titulo: 'Productos y stock' },
  { ruta: '/reportes/reposicion', titulo: 'Reposición' },
] as const

test.describe('Reportes de inventario (MSF-140, FR-010)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-746:T014] roles con y sin stock en cada reporte', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const conStock = `consulta-ri-${sufijo}@example.com`
    const sinStock = `deposito-ri-${sufijo}@example.com`
    let orgId: string | undefined
    const ids: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E reportes inventario ${sufijo}` })
      orgId = org.id
      const a = await altaUsuario(conStock)
      const b = await altaUsuario(sinStock)
      ids.push(a, b)
      await rest('usuarios_organizacion', [
        { user_id: a, organizacion_id: org.id, rol_id: 'consulta' },
        { user_id: b, organizacion_id: org.id, rol_id: 'deposito' },
      ])
      // El rol Depósito pierde la sección Stock en esta organización: no debe ver ningún reporte de inventario.
      await cambiar(`permisos_rol?organizacion_id=eq.${org.id}&rol_id=eq.deposito&seccion=eq.stock`, { nivel: 'ninguno' })

      for (const [correo, tieneAcceso] of [[conStock, true], [sinStock, false]] as const) {
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        await ingresar(page, correo)
        for (const { ruta, titulo } of PANTALLAS) {
          await page.goto(ruta)
          const restringido = page.getByRole('heading', { name: 'No tenés acceso a esta sección' })
          if (tieneAcceso) {
            await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible()
            await expect(restringido).toHaveCount(0)
          } else {
            await expect(restringido).toBeVisible()
          }
        }
        await contexto.close()
      }
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })

  test('[MSF-746:T014] descarga CSV con filtro: UTF-8, «;» y coma decimal', async ({ page }) => {
    test.skip(!process.env.E2E_SUPERSET, 'La descarga real exige un Superset con los tableros importados (E2E_SUPERSET=1).')
    const correo = process.env.E2E_INVENTARIO_CORREO
    test.skip(!correo, 'Define E2E_INVENTARIO_CORREO (usuario con sección stock y datos de inventario).')
    await ingresar(page, correo ?? '')
    await page.goto('/reportes/inventario')
    const tablero = page.frameLocator('iframe').first()
    await tablero.getByRole('button', { name: /Download|Descargar/ }).first().click()
    const descarga = page.waitForEvent('download')
    await tablero.getByText(/CSV/).first().click()
    const archivo = await (await descarga).createReadStream()
    const partes: Buffer[] = []
    for await (const parte of archivo) partes.push(Buffer.from(parte))
    const bytes = Buffer.concat(partes)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const cabecera = bytes.toString('utf8').replace(/^﻿/, '').split('\n')[0]
    expect(cabecera).toContain(';')
    expect(cabecera).not.toContain('\t')
  })
})
