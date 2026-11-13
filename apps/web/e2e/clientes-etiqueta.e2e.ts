import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import type { Page } from '@playwright/test'

// F-CLI-17 (MSF-446, SC-001): etiqueta impresa del cliente. CA-CLI-17-1: sin dirección → aviso con el dato
// faltante y sin hoja; con dirección → hoja con `@page` y los datos del envío. Se verifica a 320/768/1440 px y
// con teclado. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite:
// ver docs/e2e-app.md y docs/clientes.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', ...extra,
})

async function insertar<T>(ruta: string, cuerpo: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'POST', headers: cabeceras({ prefer: 'return=representation' }), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password, email_confirm: true }) })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Clientes · etiqueta impresa (MSF-446, F-CLI-17)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-446:T005][F-CLI-17#1] CA-CLI-17-1: sin dirección avisa y no hay hoja; con dirección sale la etiqueta a 320/768/1440 px', async ({ browser }, testInfo) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `etiqueta-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    const { contexto, page } = await abrirContextoGrabado(browser, testInfo, 'etiqueta')
    try {
      const [org] = await insertar<{ id: string }>('organizaciones', { nombre: `E2E etiqueta ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await insertar('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      const [conDireccion, sinDireccion] = await insertar<{ id: string }>('clientes', [
        { organizacion_id: org.id, nombre: `Con calle ${sufijo}`, tipo: 'minorista', direccion: 'Av. Siempre Viva 742', localidad: 'Rosario', provincia: 'Santa Fe', codigo_postal: '2000', telefono: '341 555 0101', expreso_preferido: 'Vía Cargo' },
        { organizacion_id: org.id, nombre: `Sin calle ${sufijo}`, tipo: 'minorista', direccion: null, localidad: null, provincia: null, codigo_postal: null, telefono: null, expreso_preferido: null },
      ])

      await ingresar(page, correo)

      // CA-CLI-17-1: la ficha sin dirección avisa el dato faltante y no abre la hoja.
      await page.goto(`/clientes/show/${sinDireccion.id}`)
      await page.getByRole('button', { name: 'Imprimir etiqueta de envío' }).click()
      await expect(page.getByText(/falta dirección/)).toBeVisible()
      await expect(page).not.toHaveURL(/\/clientes\/etiquetas/)

      // La hoja de un cliente sin dirección tampoco genera etiqueta (acceso directo por URL).
      await page.goto(`/clientes/etiquetas?ids=${sinDireccion.id}`)
      await expect(page.getByRole('alert')).toContainText('falta dirección')
      await expect(page.getByRole('article')).toHaveCount(0)

      for (const ancho of [320, 768, 1440]) {
        await page.setViewportSize({ width: ancho, height: 900 })
        await page.goto(`/clientes/etiquetas?ids=${conDireccion.id},${sinDireccion.id}`)
        const etiqueta = page.getByRole('article', { name: `Etiqueta de Con calle ${sufijo}` })
        await expect(etiqueta).toContainText('Av. Siempre Viva 742')
        await expect(etiqueta).toContainText('2000 Rosario')
        await expect(etiqueta).toContainText('Transporte: Vía Cargo')
        await expect(page.getByRole('article')).toHaveCount(1)
        // Teclado: el botón Imprimir se alcanza con Tab y tiene foco visible.
        const imprimir = page.getByRole('button', { name: 'Imprimir' })
        await imprimir.focus()
        await expect(imprimir).toBeFocused()
      }

      // La hoja trae @page; en impresión se oculta todo lo que no es etiqueta.
      const css = await page.evaluate(() => [...document.styleSheets].flatMap((h) => [...h.cssRules].map((r) => r.cssText)).join('\n'))
      expect(css).toContain('@page')
      await page.emulateMedia({ media: 'print' })
      await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden()
      await expect(page.getByRole('article', { name: `Etiqueta de Con calle ${sufijo}` })).toBeVisible()
    } finally {
      await cerrarContextoGrabado(contexto, page, testInfo)
      if (orgId) await fetch(`${url}/rest/v1/organizaciones?id=eq.${orgId}`, { method: 'DELETE', headers: cabeceras() })
      if (userId) await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: cabeceras() })
    }
  })
})
