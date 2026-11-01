import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'

// F-VTA-31 (MSF-329, CA-VTA-31-1): en la Venta de mostrador, escanear el código de un producto agrega la línea y
// escanear un código inexistente muestra «Producto no encontrado». Requiere el stack local (`pnpm dev:supabase`).
// Siembra con la API admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público): ver docs/e2e-app.md y docs/ventas-mostrador.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-mostrador: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function leer<T>(ruta: string, esquema = 'dominio'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
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

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Ventas · venta de mostrador con lector (MSF-329, SC-001)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-329:T007] [F-VTA-31#1] escanear agrega la línea y un código inexistente muestra «Producto no encontrado»', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-mostrador-${sufijo}@example.com`
    const codigo = '7790001000011'
    let organizacionId: string | null = null
    let usuarioId: string | null = null
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E mostrador ${sufijo}` })
      organizacionId = org.id
      const [empresa] = await rest<{ id: string }>(
        'empresas',
        { organizacion_id: org.id, nombre: `Tienda Mostrador ${sufijo}`, razon_social: `Tienda ${sufijo} SRL`, cuit: '30712345678' },
        'dominio',
      )
      usuarioId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: usuarioId, organizacion_id: org.id, rol_id: 'administrador' })
      // Empresa activa: sin ella el usuario entra en «Todas mis empresas» y la pantalla pide elegir una tienda.
      await rest('usuario_empresa_activa', { user_id: usuarioId, empresa_id: empresa.id })

      // Producto de lista $1.000 con código de barras y el depósito principal de la tienda.
      const nombreProducto = `Joystick ${sufijo}`
      await rest('productos', { organizacion_id: org.id, nombre: nombreProducto, sku: `JOY-${sufijo}`, moneda: 'ARS', precio_lista: 1000, codigo_barras: codigo }, 'dominio')
      const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`)
      await rest('depositos_empresas', { deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }, 'dominio')
      // El cliente «Consumidor final» lo crea el disparador `organizaciones_crear_consumidor_final` al insertar la
      // organización: sembrarlo rompe el índice único `clientes_consumidor_final_uq` (409).

      await ingresar(page, correo)
      await page.goto('/ventas/mostrador')
      await expect(page.getByRole('heading', { name: 'Venta de mostrador' })).toBeVisible()

      // Código inexistente: aviso y la venta sigue vacía.
      const campo = page.getByLabel('Escaneá o ingresá el código de barras')
      await campo.fill('7790000000000')
      await campo.press('Enter')
      await expect(page.getByText('Producto no encontrado')).toBeVisible()

      // Código real: se agrega la línea al comprobante de mostrador (Consumidor final, escala x1 = $1.000).
      await campo.fill(codigo)
      await campo.press('Enter')
      const tabla = page.getByRole('table', { name: 'Productos de la venta' })
      await expect(tabla.getByText(nombreProducto)).toBeVisible()
      const totales = page.getByRole('group', { name: 'Totales de la venta' })
      await expect(totales).toContainText('Total: $ 1.000')

      // Escanearlo de nuevo incrementa la cantidad en vez de duplicar la línea.
      await campo.fill(codigo)
      await campo.press('Enter')
      await expect(tabla.getByRole('row')).toHaveCount(2)
      await expect(tabla.getByRole('cell', { name: '2', exact: true })).toBeVisible()
    } finally {
      try {
        if (organizacionId) await fetch(`${url}/rest/v1/organizaciones?id=eq.${organizacionId}`, { method: 'DELETE', headers: cabeceras() })
      } finally {
        if (usuarioId) await fetch(`${url}/auth/v1/admin/users/${usuarioId}`, { method: 'DELETE', headers: cabeceras() })
      }
    }
  })
})
