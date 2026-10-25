import { randomUUID } from 'node:crypto'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible } from './visible'

// Cierre de MSF-136 (T021, SC-001): producto → entrada 10 → salida 4 → ajuste a 3
// → stock 3 y tres filas en el historial; una salida de 5 se rechaza con «No hay
// stock suficiente». Requiere el stack local (`pnpm dev:supabase`) y la web
// servida; siembra con la API admin desde Node (la service-role key nunca llega
// al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de stock: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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
  await prepararPaginaVisible(page)
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

// Abre el diálogo desde la fila del producto y completa tipo y cantidad.
async function abrirMovimiento(page: Page, nombre: string, tipo: 'Entrada' | 'Salida' | 'Ajuste', cantidad: string) {
  await clic(page, page.getByRole('button', { name: `Nuevo movimiento de ${nombre}` }))
  const dialogo = page.getByRole('dialog', { name: 'Registrar movimiento de stock' })
  await clic(page, dialogo.getByRole('button', { name: tipo, exact: true }))
  await escribir(page, dialogo.getByLabel(tipo === 'Ajuste' ? 'Stock contado' : 'Cantidad'), cantidad)
  return dialogo
}

// El primer motivo activo del tipo (los motivos se siembran por organización).
async function elegirMotivo(page: Page, dialogo: Locator) {
  await clic(page, dialogo.getByLabel('Motivo'))
  await clic(page, page.getByRole('option').first())
}

// La columna «Stock» es la segunda celda de la fila (tras Producto): no se asierta sobre la fila
// entera porque el nombre lleva un sufijo hex con dígitos.
const celdaStock = (fila: Locator) => fila.getByRole('cell').nth(1)

async function registrar(page: Page, nombre: string, tipo: 'Entrada' | 'Salida' | 'Ajuste', cantidad: string) {
  const dialogo = await abrirMovimiento(page, nombre, tipo, cantidad)
  await elegirMotivo(page, dialogo)
  await clic(page, dialogo.getByRole('button', { name: 'Registrar', exact: true }))
  await expect(dialogo.getByText('Movimiento registrado')).toBeVisible()
  // Hay dos «Cerrar» (la X del título y el botón de texto): se usa el de texto.
  await clic(page, dialogo.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }))
}

test.describe('Stock · movimientos (F-STK-02/03/06, SC-001)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // En modo visible (rótulos, cursor y cámara lenta) el recorrido tarda más.
  test.setTimeout(180000)

  test('[MSF-136:T021] entrada 10, salida 4 y ajuste a 3 dejan stock 3 y tres filas; una salida de 5 se rechaza', async ({ browser }, testInfo) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-stock-${sufijo}@example.com`
    const nombre = `Producto stock ${sufijo}`

    let grabacion: { contexto: BrowserContext; page: Page } | undefined
    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E stock ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      // La existencia nace en 0 por el disparador de productos.
      await rest('productos', { organizacion_id: org.id, nombre, sku: `E2E-${sufijo}`, precio_lista: 10 }, 'dominio')

      grabacion = await abrirContextoGrabado(browser, testInfo)
      const { page } = grabacion
      await paso(page, 'Ingresa como administrador', () => ingresar(page, correo))
      await page.goto('/stock')
      const fila = page.getByRole('row', { name: new RegExp(nombre) })

      await paso(page, 'Entrada de 10 unidades: el stock pasa a 10', async () => {
        await registrar(page, nombre, 'Entrada', '10')
        await expect(celdaStock(fila)).toHaveText('10')
      })
      await paso(page, 'Salida de 4: quedan 6', async () => {
        await registrar(page, nombre, 'Salida', '4')
        await expect(celdaStock(fila)).toHaveText('6')
      })
      await paso(page, 'Ajuste a 3 (stock contado): queda en 3', async () => {
        await registrar(page, nombre, 'Ajuste', '3')
        await expect(celdaStock(fila)).toHaveText('3')
      })

      // Una salida de 5 con stock 3: aviso y «Registrar» deshabilitado.
      await paso(page, 'Una salida de 5 con stock 3 se rechaza', async () => {
        const dialogo = await abrirMovimiento(page, nombre, 'Salida', '5')
        await expect(dialogo.getByText('No hay stock suficiente')).toBeVisible()
        await expect(dialogo.getByRole('button', { name: 'Registrar', exact: true })).toBeDisabled()
        await clic(page, dialogo.getByRole('button', { name: 'Cancelar' }))
        await expect(celdaStock(fila)).toHaveText('3')
      })

      // El historial tiene exactamente tres movimientos (el rechazo no deja rastro).
      await paso(page, 'El historial tiene exactamente tres movimientos', async () => {
        await page.goto('/stock/movimientos')
        await expect(page.getByText('3 movimientos')).toBeVisible()
      })
    } finally {
      if (grabacion) await cerrarContextoGrabado(grabacion.contexto, grabacion.page, testInfo)
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
