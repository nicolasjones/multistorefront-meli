import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// MSF-716 (F-STK-11, T014): la toma de inventario con una categoría grande fallaba porque el stock
// del depósito se pedía con un único `in.(…)` en la URL del GET (≈9,9 KB con 250 ids: pasa del
// límite de 8 KB del proxy) y la pantalla mostraba «No pudimos cargar los productos de esta
// categoría». Con el reparto en lotes (100 ids por petición) la categoría carga entera.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde
// Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// el archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de toma de inventario: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Categoría grande: con 250 ids la URL del `in.(…)` mide ≈9,9 KB (el proxy corta a 8 KB).
const CANTIDAD_PRODUCTOS = 250

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

// Alta masiva: no hace falta la representación de 250 filas.
async function restMinimo(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<void> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=minimal', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
}

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
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

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Stock · toma de inventario con categoría grande (MSF-716, F-STK-11 T014)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-716:FIX] [F-STK-11#T014] una categoría con 250 productos carga la tabla completa (no «No pudimos cargar los productos de esta categoría»)', async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-toma-${sufijo}@example.com`
    const nombreCategoria = `Categoría grande ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      // Siembra: organización (crea el depósito por defecto), administrador, categoría y 250 productos.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E toma ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [categoria] = await rest<{ id: string }>(
        'categorias',
        { organizacion_id: org.id, nombre: nombreCategoria, posicion: 0 },
        'dominio',
      )
      await restMinimo('productos', Array.from({ length: CANTIDAD_PRODUCTOS }, (_, i) => ({
        organizacion_id: org!.id,
        categoria_id: categoria.id,
        nombre: `Producto toma ${sufijo} ${i}`,
        sku: `E2E-TOMA-${sufijo}-${i}`,
        precio_lista: 100,
      })), 'dominio')

      const { contexto, page } = await abrirContextoGrabado(browser, testInfo)
      try {
        await prepararPaginaVisible(page)
        await ingresar(page, correo)
        await rotulo(page, 'Abre Stock → Toma de inventario')
        await paso(page, 'Abre la toma de inventario', async () => {
          await page.goto('/stock/toma-inventario')
          await expect(page.getByRole('combobox', { name: 'Categoría' })).toBeVisible()
        })
        await paso(page, `Elige la categoría con ${CANTIDAD_PRODUCTOS} productos`, async () => {
          await clic(page, page.getByRole('combobox', { name: 'Categoría' }))
          await clic(page, page.getByRole('option', { name: nombreCategoria }))
        })
        // La tabla carga entera: los 250 productos, con su stock en el sistema.
        const tabla = page.getByRole('table', { name: 'Productos de la toma de inventario' })
        await expect(tabla).toBeVisible({ timeout: 60_000 })
        await expect(tabla.getByRole('row')).toHaveCount(CANTIDAD_PRODUCTOS + 1)
        await expect(tabla.getByText(`Producto toma ${sufijo} 249`)).toBeVisible()
        // El síntoma del bug era este mensaje: no puede aparecer.
        await expect(page.getByText('No pudimos cargar los productos de esta categoría')).toHaveCount(0)
      } finally {
        await cerrarContextoGrabado(contexto, page, testInfo)
      }
    } finally {
      // Limpieza: la organización arrastra productos, categoría y depósitos (cascade).
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
