import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// Cierre de MSF-229 (MSF-765 · T029 · SC-006): recorrido «variantes + relacionados + suma de stock» en la
// ficha del producto: se agregan tres variantes con stock, se relaciona otro producto, se guarda, y al
// reabrir la ficha el stock del producto es la suma de las variantes activas (desactivar una la resta).
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no corre en el CI público). Ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de variantes: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

type Sembrado = { orgId: string; idUsuario: string; correo: string; idRemera: string }

async function sembrar(sufijo: string): Promise<Sembrado> {
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E variantes ${sufijo}` })
  const correo = `admin-variantes-${sufijo}@example.com`
  const idUsuario = await altaUsuario(correo)
  await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
  const [remera, gorra] = await rest<{ id: string }>(
    'productos',
    [
      { organizacion_id: org.id, nombre: `Remera ${sufijo}`, sku: `E2E-VR-R-${sufijo}`, moneda: 'ARS', precio_lista: 9500 },
      { organizacion_id: org.id, nombre: `Gorra ${sufijo}`, sku: `E2E-VR-G-${sufijo}`, moneda: 'ARS', precio_lista: 4200 },
    ],
    'dominio',
  )
  void gorra
  return { orgId: org.id, idUsuario, correo, idRemera: remera.id }
}

async function limpiar(datos: Sembrado) {
  await borrar(`registro_actividad?organizacion_id=eq.${datos.orgId}`)
  await borrar(`productos?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  await borrarUsuario(datos.idUsuario)
}

const bloqueVariantes = (page: Page) => page.getByRole('region', { name: 'Variantes' })
const bloqueRelacionados = (page: Page) => page.getByRole('region', { name: 'Productos relacionados' })

test.describe('Variantes, relacionados y suma de stock en la ficha (MSF-765 · cierre MSF-229)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-765:T029] variantes + relacionados: el stock del producto es la suma de las variantes activas', async ({ page }) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    try {
      datos = await sembrar(sufijo)
      await prepararPaginaVisible(page)
      await ingresar(page, datos.correo)
      await paso(page, 'Abro la ficha de la remera', async () => {
        await page.goto(`/productos/${datos!.idRemera}/edit`)
      })
      await expect(bloqueVariantes(page)).toBeVisible()

      const stocks = [5, 7, 3]
      for (const [i, stock] of stocks.entries()) {
        const n = i + 1
        await paso(page, `Agrego la variante ${n}`, async () => {
          await clic(page, bloqueVariantes(page).getByRole('button', { name: 'Agregar variante' }))
          await escribir(page, bloqueVariantes(page).getByRole('textbox', { name: `Nombre de la variante ${n}` }), `Talle ${n}`)
          await escribir(page, bloqueVariantes(page).getByRole('textbox', { name: `Código de la variante ${n}` }), `E2E-VR-${sufijo}-${n}`)
          await escribir(page, bloqueVariantes(page).getByRole('spinbutton', { name: `Stock de la variante ${n}` }), String(stock))
        })
      }
      await expect(bloqueVariantes(page)).toContainText('suma de las variantes activas): 15')

      await paso(page, 'Relaciono la gorra', async () => {
        await escribir(page, bloqueRelacionados(page).getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), `Gorra ${sufijo}`)
        await clic(page, bloqueRelacionados(page).getByRole('button', { name: `Agregar Gorra ${sufijo}` }))
      })
      await expect(bloqueRelacionados(page).getByText('1 producto')).toBeVisible()

      await paso(page, 'Guardo los cambios', async () => {
        await clic(page, page.getByRole('button', { name: 'Guardar cambios' }))
      })
      await expect(page.getByText('Producto guardado')).toBeVisible()

      await paso(page, 'Reabro la ficha', async () => {
        await page.reload()
      })
      await expect(bloqueVariantes(page)).toContainText('suma de las variantes activas): 15')
      await expect(bloqueRelacionados(page).getByText('1 producto')).toBeVisible()

      // Lectura de la base: tres variantes con la suma esperada y el relacionado guardado.
      // La vista `v_producto_variantes` calcula el stock según la sección de quien lee (la service-role no tiene
      // ninguna: devuelve null), por eso el stock se lee de la tabla de existencias.
      const variantes = await leer<{ id: string; activa: boolean }>(`v_producto_variantes?producto_id=eq.${datos.idRemera}&select=id,activa`)
      expect(variantes).toHaveLength(3)
      const existencias = await leer<{ cantidad: number }>(`existencias_variante?variante_id=in.(${variantes.map((v) => v.id).join(',')})&select=cantidad`, 'dominio')
      expect(existencias.reduce((suma, e) => suma + e.cantidad, 0)).toBe(15)
      const rel = await leer<{ nombre: string }>(`v_producto_relacionados?producto_id=eq.${datos.idRemera}&select=nombre`)
      expect(rel.map((r) => r.nombre)).toEqual([`Gorra ${sufijo}`])

      // Desactivar una variante la saca de la suma.
      await paso(page, 'Desactivo la variante 3', async () => {
        await clic(page, bloqueVariantes(page).getByRole('switch', { name: 'Activa: Talle 3' }))
        await clic(page, page.getByRole('button', { name: 'Guardar cambios' }))
      })
      await expect(page.getByText('Producto guardado')).toBeVisible()
      await page.reload()
      await expect(bloqueVariantes(page)).toContainText('suma de las variantes activas): 12')

      await rotulo(page, 'El stock del producto es la suma de sus variantes activas')
    } finally {
      if (datos) await limpiar(datos)
    }
  })
})
