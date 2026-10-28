import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-VTA-32 (MSF-340, CA-VTA-32-1): un cliente con 5 % de descuento agrega una línea y el precio refleja la
// escala menos 5 %. Requiere el stack local (`pnpm dev:supabase`). Siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no entra al CI público): ver docs/e2e-app.md y docs/ventas-mejoras.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-precios-especiales: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

test.describe('Ventas · precios especiales por cliente (MSF-340, SC-002)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-340:T013] [F-VTA-32#1] cliente con 5 % agrega una línea y el precio es la escala menos 5 %', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-dto-${sufijo}@example.com`
    let organizacionId: string | null = null
    let usuarioId: string | null = null
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E descuento ${sufijo}` })
      organizacionId = org.id
      const [empresa] = await rest<{ id: string }>(
        'empresas',
        { organizacion_id: org.id, nombre: `Tienda Descuento ${sufijo}`, razon_social: `Tienda ${sufijo} SRL`, cuit: '30712345678' },
        'dominio',
      )
      usuarioId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: usuarioId, organizacion_id: org.id, rol_id: 'administrador' })

      // Producto de lista $1.000 (minorista = escala x1) y el depósito principal de la tienda.
      const nombreProducto = `Joystick ${sufijo}`
      await rest('productos', { organizacion_id: org.id, nombre: nombreProducto, sku: `JOY-${sufijo}`, moneda: 'ARS', precio_lista: 1000 }, 'dominio')
      const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`)
      await rest('depositos_empresas', { deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }, 'dominio')

      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id, numero: 1, nombre: `Cliente con descuento ${sufijo}`, tipo: 'minorista', descuento: 5,
      })
      const [factura] = await rest<{ id: string }>(
        'comprobantes_venta',
        {
          organizacion_id: org.id, cliente_id: cliente.id, empresa_id: empresa.id, tipo: 'factura', numero: '00000001',
          estado: 'borrador', fecha: new Date().toISOString().slice(0, 10), total_sin_iva: 0, total_con_iva: 0,
          canal: 'mostrador', operador_id: usuarioId,
        },
        'dominio',
      )

      await ingresar(page, correo)
      await page.goto(`/ventas/comprobantes/${factura.id}`)
      await page.getByRole('button', { name: 'Agregar producto' }).click()
      const dialogo = page.getByRole('dialog', { name: 'Agregar producto' })
      await dialogo.getByLabel('Buscar producto del catálogo').fill(nombreProducto)
      await page.getByRole('option', { name: new RegExp(nombreProducto) }).click()
      await dialogo.getByRole('button', { name: 'Agregar', exact: true }).click()

      // Escala x1 ($1.000) menos 5 % = $950; la línea muestra el descuento aplicado.
      await expect(page.getByText('escala x1 · 5 % de descuento')).toBeVisible()
      await expect(page.getByText(/950/).first()).toBeVisible()
    } finally {
      try {
        if (organizacionId) await fetch(`${url}/rest/v1/organizaciones?id=eq.${organizacionId}`, { method: 'DELETE', headers: cabeceras() })
      } finally {
        if (usuarioId) await fetch(`${url}/auth/v1/admin/users/${usuarioId}`, { method: 'DELETE', headers: cabeceras() })
      }
    }
  })
})
