import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-114 (T043, SC-009): producto en USD con costo → su precio en dos empresas con
// reglas distintas → interruptor de IVA → precio final y margen. Requiere el stack local
// (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role
// key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md.
//
// Cifras (dólar 1.465, lista USD 20, costo USD 12, IVA 21 %):
//   central $ 29.300 · costo $ 17.580 · margen (29.300 − 17.580) / 29.300 = 40 %
//   empresa A «Igual al central»  → neto $ 29.300 · final $ 35.453
//   empresa B «Central +10 %»     → neto $ 32.230 · final $ 38.998 (32.230 × 1,21 = 38.998,3)
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de precios: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function modificar(ruta: string, cuerpo: unknown, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
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

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'DELETE',
    headers: cabeceras({ 'content-profile': esquema }),
  })
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

test.describe('Precios e IVA (MSF-114, SC-009)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('producto en USD con costo: precio en dos empresas con reglas distintas, interruptor de IVA y margen', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-precios-${sufijo}@example.com`
    const nombre = `Producto USD ${sufijo}`
    const empresaA = `Tienda A ${sufijo}`
    const empresaB = `Tienda B ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E precios ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [tiendaA, tiendaB] = await rest<{ id: string }>(
        'empresas',
        [
          { organizacion_id: org.id, nombre: empresaA },
          { organizacion_id: org.id, nombre: empresaB },
        ],
        'dominio',
      )
      await rest('cotizacion_inicial', { organizacion_id: org.id, valor: 1465 }, 'dominio')
      // Empresa A: sin fila = «Igual al central». Empresa B: central con +10 %.
      await rest('precios_empresa', { empresa_id: tiendaB.id, organizacion_id: org.id, base: 'central_ajuste', ajuste_pct: 10 }, 'dominio')

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)

      // 1. Alta del producto en USD con costo, desde la pantalla.
      await page.goto('/productos/create')
      await page.getByLabel('Nombre').fill(nombre)
      await page.getByLabel('Moneda').click()
      await page.getByRole('option', { name: /USD|Dólar/ }).click()
      await page.getByLabel('Precio de lista (sin IVA)').fill('20')
      await page.getByLabel('Costo').fill('12')
      await expect(page.getByLabel('Precio en pesos')).toHaveValue('$ 29.300')
      await expect(page.getByText(/costo \$ 17\.580 · con dólar \$ 1\.465/)).toBeVisible()
      await expect(page.getByText('Margen estimado (escala x1):')).toContainText('40 %')
      await page.getByRole('button', { name: 'Crear producto' }).click()
      await expect(page.getByText(`${nombre} quedó activo en el catálogo.`)).toBeVisible()

      // El alta no asigna alícuota (hereda de una categoría): se fija el 21 % con la API admin
      // para comprobar el precio final.
      const [producto] = await leer<{ id: string }>(`productos?organizacion_id=eq.${org.id}&nombre=eq.${encodeURIComponent(nombre)}&select=id`, 'dominio')
      const [alicuota] = await leer<{ id: string }>(`alicuotas_iva?organizacion_id=eq.${org.id}&porcentaje=eq.21&exento=eq.false&select=id`, 'dominio')
      await modificar(`productos?id=eq.${producto.id}`, { alicuota_iva_id: alicuota.id }, 'dominio')

      // 2. Empresa A («Igual al central»): neto 29.300, final 35.453 al activar «Con IVA incluido».
      await page.goto(`/empresas/edit/${tiendaA.id}/precios`)
      const filaA = page.getByRole('row', { name: new RegExp(nombre) })
      await expect(filaA).toContainText('$ 29.300')
      await expect(page.getByRole('columnheader', { name: `${empresaA} · Sin IVA` })).toBeVisible()
      await page.getByRole('button', { name: 'Con IVA incluido' }).click()
      await expect(page.getByRole('columnheader', { name: `${empresaA} · Con IVA incluido` })).toBeVisible()
      await expect(filaA).toContainText('$ 35.453')
      await page.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled()

      // 3. Empresa B (+10 %): neto 32.230; con IVA, 38.998.
      await page.goto(`/empresas/edit/${tiendaB.id}/precios`)
      const filaB = page.getByRole('row', { name: new RegExp(nombre) })
      await expect(filaB).toContainText('$ 29.300')
      await expect(filaB).toContainText('$ 32.230')
      await page.getByRole('button', { name: 'Con IVA incluido' }).click()
      await expect(filaB).toContainText('$ 38.998')

      // 4. El interruptor guardado en A persiste, y el margen no cambia con el IVA
      //    (se calcula siempre sobre el neto).
      await page.goto(`/empresas/edit/${tiendaA.id}/precios`)
      await expect(page.getByRole('columnheader', { name: `${empresaA} · Con IVA incluido` })).toBeVisible()
      await page.goto(`/productos/${producto.id}/edit`)
      await expect(page.getByText('Margen estimado (escala x1):')).toContainText('40 %')
      await contexto.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
