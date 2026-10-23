import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-116 (T031, SC-009): cargar el dólar, ver la vista previa por empresa, confirmar y
// comprobar los precios; y una carga bajo el umbral (1 %) que se registra sin recalcular. Requiere
// el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md.
//
// Cifras (vigente $ 1.000, producto USD 20, empresa A «Igual al central», empresa B «Central +10 %»):
//   hoy    A $ 20.000 · B $ 22.000
//   1050   → central 21.000 → A $ 21.000 · B $ 23.100 (21.000 × 1,10), recalcula 2 precios (1 producto × 2 empresas)
//   1005   → variación 0,5 % < 1 % → se registra, los precios siguen en A $ 20.000 · B $ 22.000

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de cotización: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

type Escenario = { ids: string[]; correo: string; orgId: string; idUsuario: string; empresaA: string; empresaB: string; nombre: string }

// Organización con administrador, dos empresas (B con +10 %), dólar vigente 1.000 y un producto en USD 20.
async function sembrar(sufijo: string): Promise<Escenario> {
  const correo = `admin-cotizacion-${sufijo}@example.com`
  const nombre = `Producto USD ${sufijo}`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E cotización ${sufijo}` })
  const idUsuario = await altaUsuario(correo)
  await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
  const empresaA = `Tienda A ${sufijo}`
  const empresaB = `Tienda B ${sufijo}`
  const [tiendaA, tiendaB] = await rest<{ id: string }>(
    'empresas',
    [
      { organizacion_id: org.id, nombre: empresaA },
      { organizacion_id: org.id, nombre: empresaB },
    ],
    'dominio',
  )
  await rest('cotizacion_inicial', { organizacion_id: org.id, valor: 1000 }, 'dominio')
  await rest('precios_empresa', { empresa_id: tiendaB.id, organizacion_id: org.id, base: 'central_ajuste', ajuste_pct: 10 }, 'dominio')
  await rest('productos', { organizacion_id: org.id, nombre, sku: `E2E-USD-${sufijo}`, moneda: 'USD', precio_lista: 20 }, 'dominio')
  return { correo, orgId: org.id, idUsuario, empresaA, empresaB, nombre, ids: [tiendaA.id, tiendaB.id] }
}

async function limpiar(escenario: Escenario | undefined) {
  // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
  if (!escenario) return
  await borrar(`usuarios_organizacion?organizacion_id=eq.${escenario.orgId}`)
  await borrar(`organizaciones?id=eq.${escenario.orgId}`)
  await borrarUsuario(escenario.idUsuario)
}

async function cargarDolar(page: Page, valor: string) {
  await page.goto('/cotizacion')
  await page.getByRole('button', { name: 'Cargar cotización' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Cargar dólar del día' })
  await dialogo.getByLabel('Dólar del día (pesos por dólar)').fill(valor)
  await dialogo.getByRole('button', { name: 'Cargar dólar' }).click()
  return dialogo
}

async function preciosDeEmpresa(page: Page, empresaId: string, nombre: string) {
  await page.goto(`/empresas/edit/${empresaId}/precios`)
  return page.getByRole('row', { name: new RegExp(nombre) })
}

test.describe('Dólar y recálculo (MSF-116, SC-009)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('cargar 1050 con vigente 1000: vista previa por empresa, confirmar y precios recalculados', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    let escenario: Escenario | undefined
    try {
      escenario = await sembrar(sufijo)
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, escenario.correo)

      // Antes: los precios salen del dólar vigente (1.000).
      const [idA, idB] = escenario.ids
      await expect(await preciosDeEmpresa(page, idA, escenario.nombre)).toContainText('$ 20.000')
      await expect(await preciosDeEmpresa(page, idB, escenario.nombre)).toContainText('$ 22.000')

      // Cargar 1050 deja la cotización pendiente y muestra qué cambiaría, por empresa.
      const dialogo = await cargarDolar(page, '1050')
      await expect(dialogo.getByRole('heading', { name: 'Qué va a cambiar' })).toBeVisible()
      const muestra = dialogo.getByRole('table', { name: 'Productos de muestra con su precio de hoy y el nuevo' })
      await expect(muestra).toContainText(escenario.nombre)
      await expect(muestra).toContainText('$ 21.000')
      await expect(muestra).toContainText('$ 23.100')
      await expect(dialogo.getByText('Redondeo al $ 10 más cercano.')).toBeVisible()

      // Confirmar recalcula todas las empresas juntas.
      await page.getByRole('button', { name: 'Aplicar y recalcular' }).click()
      await expect(page.getByText('Cotización aplicada · 2 precios recalculados')).toBeVisible()
      await expect(page.getByText('Historial de cargas')).toBeVisible()

      await expect(await preciosDeEmpresa(page, idA, escenario.nombre)).toContainText('$ 21.000')
      await expect(await preciosDeEmpresa(page, idB, escenario.nombre)).toContainText('$ 23.100')
      await contexto.close()
    } finally {
      await limpiar(escenario)
    }
  })

  test('cargar 1005 con vigente 1000: se registra sin recalcular los precios', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    let escenario: Escenario | undefined
    try {
      escenario = await sembrar(sufijo)
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, escenario.correo)

      const dialogo = await cargarDolar(page, '1005')
      await expect(dialogo.getByText('Sin recálculo')).toBeVisible()
      await page.getByRole('button', { name: 'Registrar cotización' }).click()
      await expect(page.getByText('Cotización registrada · variación menor al umbral, precios sin cambios')).toBeVisible()

      // Los precios siguen con el dólar anterior.
      const [idA, idB] = escenario.ids
      await expect(await preciosDeEmpresa(page, idA, escenario.nombre)).toContainText('$ 20.000')
      await expect(await preciosDeEmpresa(page, idB, escenario.nombre)).toContainText('$ 22.000')
      await contexto.close()
    } finally {
      await limpiar(escenario)
    }
  })
})
