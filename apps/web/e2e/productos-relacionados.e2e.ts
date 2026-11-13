import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// F-CAT-18 (MSF-416, épica MSF-229 · T008 · FR-014…FR-017, SC-003): el bloque «Productos relacionados» de
// la ficha del producto: buscador por nombre/SKU/categoría (hasta 4 resultados, con «Agregar»), lista
// numerada con ↑ ↓ ✕, avisos y guardado con «Guardar cambios»; el orden guardado se vuelve a leer igual al
// reabrir la ficha (SC-003).
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no corre en el CI público). Ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de relacionados: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
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

type Sembrado = { orgId: string; idUsuario: string; correo: string; idConsola: string }

// Tres productos de la misma organización: el que se edita (la consola) y dos para relacionar.
async function sembrar(sufijo: string): Promise<Sembrado> {
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E relacionados ${sufijo}` })
  const correo = `admin-relacionados-${sufijo}@example.com`
  const idUsuario = await altaUsuario(correo)
  await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
  const [consola, vidrio, funda] = await rest<{ id: string }>(
    'productos',
    [
      { organizacion_id: org.id, nombre: `Consola ${sufijo}`, sku: `E2E-RL-C-${sufijo}`, moneda: 'ARS', precio_lista: 18455 },
      { organizacion_id: org.id, nombre: `Vidrio templado ${sufijo}`, sku: `E2E-RL-V-${sufijo}`, moneda: 'ARS', precio_lista: 4785 },
      { organizacion_id: org.id, nombre: `Funda ${sufijo}`, sku: `E2E-RL-F-${sufijo}`, moneda: 'ARS', precio_lista: 5062 },
    ],
    'dominio',
  )
  return { orgId: org.id, idUsuario, correo, idConsola: consola.id }
}

async function limpiar(datos: Sembrado) {
  await borrar(`productos?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  await borrarUsuario(datos.idUsuario)
}

// El bloque es una <section> con el título como nombre accesible: todo se acota a él.
const bloque = (page: Page) => page.getByRole('region', { name: 'Productos relacionados' })
const resultados = (page: Page) => bloque(page).getByRole('list', { name: 'Resultados de la búsqueda' })
// Los ítems de la lista de relacionados (numerados): el bloque ya no muestra resultados con la búsqueda vacía.
const relacionados = (page: Page) => bloque(page).getByRole('listitem')

test.describe('Productos relacionados en la ficha del producto (MSF-416 · F-CAT-18)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-416:T008] buscar, agregar, reordenar y guardar: el orden guardado se vuelve a leer igual', async ({ page }) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    try {
      datos = await sembrar(sufijo)
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)
      await paso(page, 'Abro la ficha de la consola', async () => {
        await page.goto(`/productos/${datos!.idConsola}/edit`)
      })

      // Estado vacío del bloque (FR-014).
      await expect(bloque(page)).toBeVisible()
      await expect(bloque(page).getByText('0 productos')).toBeVisible()
      await expect(page.getByText('Todavía no hay productos relacionados. Buscá arriba y agregá accesorios o alternativas.')).toBeVisible()

      // Sin coincidencias (FR-015).
      await paso(page, 'Busco un producto que no existe', async () => {
        await escribir(page, bloque(page).getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), 'inexistente-zzz')
      })
      await expect(resultados(page).getByText('Sin resultados. Probá con otro nombre, SKU o categoría.')).toBeVisible()

      // Buscar y agregar (FR-015, FR-016).
      await paso(page, 'Busco el vidrio y lo agrego', async () => {
        await escribir(page, bloque(page).getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), `Vidrio templado ${sufijo}`)
      })
      const agregarVidrio = bloque(page).getByRole('button', { name: `Agregar Vidrio templado ${sufijo}` })
      await expect(agregarVidrio).toBeVisible()
      await clic(page, agregarVidrio)
      await expect(bloque(page).getByRole('status')).toHaveText(`Agregado a relacionados: Vidrio templado ${sufijo}`)
      await expect(bloque(page).getByText('1 producto')).toBeVisible()

      await paso(page, 'Busco la funda y la agrego', async () => {
        await escribir(page, bloque(page).getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), `Funda ${sufijo}`)
      })
      const agregarFunda = bloque(page).getByRole('button', { name: `Agregar Funda ${sufijo}` })
      await expect(agregarFunda).toBeVisible()
      await clic(page, agregarFunda)
      await expect(bloque(page).getByText('2 productos')).toBeVisible()
      await expect(relacionados(page)).toHaveText([/Vidrio templado/, /Funda/])

      // Reordenar (FR-016): ↑ del primero está atenuado y no hace nada.
      await expect(bloque(page).getByRole('button', { name: `Subir Vidrio templado ${sufijo}` })).toHaveAttribute('aria-disabled', 'true')
      await paso(page, 'Subo la funda con la flecha', async () => {
        await clic(page, bloque(page).getByRole('button', { name: `Subir Funda ${sufijo}` }))
      })
      await expect(relacionados(page)).toHaveText([/Funda/, /Vidrio templado/])

      // Guardar (FR-017).
      await paso(page, 'Guardo los cambios', async () => {
        await clic(page, page.getByRole('button', { name: 'Guardar cambios' }))
      })
      await expect(page.getByText('Producto guardado')).toBeVisible()

      // El orden guardado se vuelve a leer igual al reabrir la ficha (SC-003).
      await paso(page, 'Reabro la ficha', async () => {
        await page.reload()
      })
      await expect(bloque(page).getByText('2 productos')).toBeVisible()
      await expect(relacionados(page)).toHaveText([/Funda/, /Vidrio templado/])

      // El contrato de lectura de la base devuelve el mismo orden.
      const filas = await leer<{ orden: number; nombre: string }>(`v_producto_relacionados?producto_id=eq.${datos.idConsola}&select=orden,nombre&order=orden`)
      expect(filas.map((fila) => fila.nombre)).toEqual([`Funda ${sufijo}`, `Vidrio templado ${sufijo}`])

      // Quitar (FR-016).
      await paso(page, 'Quito el vidrio de relacionados', async () => {
        const quitar = bloque(page).getByRole('button', { name: `Quitar Vidrio templado ${sufijo}` })
        await expect(quitar).toBeVisible()
        await clic(page, quitar)
      })
      await expect(bloque(page).getByRole('status')).toHaveText('Quitado de relacionados')
      await expect(bloque(page).getByText('1 producto')).toBeVisible()
      await clic(page, page.getByRole('button', { name: 'Guardar cambios' }))
      await expect(page.getByText('Producto guardado')).toBeVisible()
      await page.reload()
      await expect(bloque(page).getByText('1 producto')).toBeVisible()
      await expect(relacionados(page)).toHaveText([/Funda/])

      await rotulo(page, 'Los relacionados quedan guardados en el orden que ve el cliente')
    } finally {
      if (datos) await limpiar(datos)
    }
  })
})
