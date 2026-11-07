import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// MSF-278 (F-AUD-03): exportar la actividad a CSV. Cubre CA-AUD-03-1 (solo las filas del filtro y sus columnas),
// CA-AUD-03-3 (más de 50.000 filas: se pide acotar y NO se descarga) y CA-AUD-03-4 (escape de comas, comillas y
// saltos de línea). Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin
// desde Node. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

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

const haceDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

async function textoDeLaDescarga(descarga: import('@playwright/test').Download): Promise<string> {
  const partes: Buffer[] = []
  for await (const parte of await descarga.createReadStream()) partes.push(Buffer.from(parte))
  return Buffer.concat(partes).toString('utf8').replace(/^﻿/, '')
}

test.describe('Exportar la actividad (F-AUD-03)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('CA-AUD-03-1 y CA-AUD-03-4: el CSV trae solo las filas del filtro, con sus columnas y bien escapadas', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-exp-${sufijo}@example.com`
    const marca = `marca${sufijo}`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E exportar ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('registro_actividad', [
        { organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'producto.creado', detalle: `Creó ${marca} uno`, creado_en: haceDias(1) },
        { organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'producto.creado', detalle: `Dijo "hola", ${marca}; chau\nfin`, creado_en: haceDias(2) },
        // Fuera del período (7 días) y sin la marca: no deben aparecer.
        { organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'producto.creado', detalle: `Viejo ${marca}`, creado_en: haceDias(40) },
        { organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'producto.creado', detalle: 'Otra cosa sin la marca', creado_en: haceDias(1) },
      ])

      await ingresar(page, correo)
      await page.goto('/actividad')
      await page.getByLabel('Buscar en la actividad').fill(marca)
      await expect(page.getByText(`Creó ${marca} uno`)).toBeVisible()

      const descarga = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Exportar' }).click()
      const csv = await textoDeLaDescarga(await descarga)

      expect(csv.split('\r\n')[0]).toBe('Cuándo;Tipo;Tienda;Detalle;Quién')
      expect(csv).toContain(`Creó ${marca} uno`)
      // CA-AUD-03-4: comillas duplicadas y celda entre comillas con el separador y el salto de línea.
      expect(csv).toContain(`"Dijo ""hola"", ${marca}; chau\nfin"`)
      // CA-AUD-03-1: solo las filas del filtro (período y texto).
      expect(csv).not.toContain(`Viejo ${marca}`)
      expect(csv).not.toContain('Otra cosa sin la marca')
      const filas = csv.split('\r\n').filter((linea) => linea !== '')
      expect(filas.length).toBeGreaterThanOrEqual(3)
    } finally {
      if (orgId) {
        await borrar(`registro_actividad?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrarUsuario(userId)
    }
  })

  test('CA-AUD-03-3: con más de 50.000 filas no se descarga nada y se pide acotar el período', async ({ page }) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-tope-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E tope ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      const total = 50_001
      const lote = 5_000
      for (let desde = 0; desde < total; desde += lote) {
        const filas = Array.from({ length: Math.min(lote, total - desde) }, (_, i) => ({
          organizacion_id: org.id,
          tipo: 'carga.masiva',
          detalle: `Evento ${desde + i}`,
          creado_en: new Date(Date.now() - (desde + i + 1) * 1000).toISOString(),
        }))
        await rest('registro_actividad', filas)
      }

      await ingresar(page, correo)
      await page.goto('/actividad')
      await page.getByLabel('Período').click()
      await page.getByRole('option', { name: /Todo/ }).click()

      let descargo = false
      page.on('download', () => { descargo = true })
      await page.getByRole('button', { name: 'Exportar' }).click()

      const aviso = page.getByRole('alert').filter({ hasText: 'acotá el período' })
      await expect(aviso).toBeVisible()
      await expect(aviso).toContainText('50.001')
      await expect(aviso).toContainText('50.000')
      // El aviso es persistente (no desaparece solo) y no se bajó ningún archivo.
      await page.waitForTimeout(8_000)
      await expect(aviso).toBeVisible()
      expect(descargo).toBe(false)
    } finally {
      if (orgId) {
        await borrar(`registro_actividad?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrarUsuario(userId)
    }
  })
})
