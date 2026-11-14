import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { cabeceras, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// MSF-816 · F-2 (T012, SC-004): precio promocional en la Venta de mostrador, contra el build. Un producto con promoción
// vigente se escanea con el precio promocional, el anterior tachado y la leyenda «Promoción»; se cobra a ese precio y el
// total del comprobante coincide con el del cobro; con la bandera `promociones_precio` apagada la pantalla es la de hoy; y
// una promoción que vence entre dos escaneos avisa «Los precios cambiaron». Requiere el stack local (`pnpm dev:supabase`) y
// `--workers=1`: la bandera es global y se comparte con los specs de la tienda (`tienda-promocion`). Siembra por la API
// admin solo contra Supabase local, sin escribir directo en tablas inalterables (docs/e2e-app.md).
// El rechazo `40001`/`precios_cambiaron` al cobrar lo emite el servidor en F-3 (T014): acá no hay E2E de ese camino (lo
// prueba Vitest simulando la respuesta); queda como seguimiento en notas.md.
const password = 'Correcta-12345!'
const CLAVE_BANDERA = 'promociones_precio'

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

async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

// La bandera es de plataforma: se fija con PATCH y se devuelve el valor previo para restaurarlo.
async function fijarBandera(activa: boolean): Promise<boolean> {
  const ruta = `banderas_plataforma?clave=eq.${CLAVE_BANDERA}`
  const l = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const previa = l.ok ? (((await l.json()) as { activa: boolean }[])[0]?.activa ?? false) : false
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera ${CLAVE_BANDERA}: ${r.status} ${await r.text()}`)
  return previa
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

type Siembra = {
  organizacionId: string
  usuarioId: string
  correo: string
  empresaId: string
  promocionId: string
  nombres: { promo: string; normal: string }
  codigos: { promo: string; normal: string }
}

const DIA = 24 * 60 * 60 * 1000

// Organización propia por corrida: tienda con depósito principal, administrador, forma de pago «Efectivo», un producto con
// promoción vigente (lista $ 1.000, promoción $ 900) y otro sin promoción ($ 500), ambos con stock.
async function sembrar(sufijo: string, codigos: { promo: string; normal: string }): Promise<Siembra> {
  const correo = `admin-promo-${sufijo}@example.com`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E mostrador promo ${sufijo}` })
  const [empresa] = await rest<{ id: string }>(
    'empresas',
    { organizacion_id: org.id, nombre: `Tienda Promo ${sufijo}`, razon_social: `Tienda ${sufijo} SRL`, cuit: '30712345678' },
    'dominio',
  )
  const usuarioId = await altaUsuario(correo)
  await rest('usuarios_organizacion', { user_id: usuarioId, organizacion_id: org.id, rol_id: 'administrador' })
  await rest('usuario_empresa_activa', { user_id: usuarioId, empresa_id: empresa.id })
  const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`)
  await rest('depositos_empresas', { deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }, 'dominio')

  const nombres = { promo: `Joystick promo ${sufijo}`, normal: `Cable normal ${sufijo}` }
  const [promo, normal] = await rest<{ id: string }>(
    'productos',
    [
      { organizacion_id: org.id, nombre: nombres.promo, sku: `PRO-${sufijo}`, moneda: 'ARS', precio_lista: 1000, codigo_barras: codigos.promo },
      { organizacion_id: org.id, nombre: nombres.normal, sku: `NOR-${sufijo}`, moneda: 'ARS', precio_lista: 500, codigo_barras: codigos.normal },
    ],
    'dominio',
  )
  for (const producto of [promo, normal]) {
    // El disparador `productos_crear_existencias` ya creó la fila: se actualiza con upsert (como ventas-rma).
    await rest('existencias?on_conflict=producto_id', [{ producto_id: producto.id, organizacion_id: org.id, cantidad: 10, reservado: 0 }], 'dominio', 'return=representation,resolution=merge-duplicates')
    await rest('existencias_deposito', [{ producto_id: producto.id, deposito_id: deposito.id, organizacion_id: org.id, cantidad: 10, reservado: 0 }], 'dominio')
  }
  const ahora = Date.now()
  const [promocion] = await rest<{ id: string }>(
    'promociones_precio',
    [{ organizacion_id: org.id, empresa_id: empresa.id, producto_id: promo.id, precio_promocional: 900, desde: new Date(ahora - DIA).toISOString(), hasta: new Date(ahora + DIA).toISOString() }],
    'dominio',
  )
  // Forma de pago por la RPC de negocio con la sesión del administrador (como la pantalla de Formas de pago).
  const token = await tokenDe(correo)
  const r = await fetch(`${url}/rest/v1/rpc/crear_forma_pago`, {
    method: 'POST',
    headers: cabeceras({ authorization: `Bearer ${token}` }),
    body: JSON.stringify({ p_empresa_ids: [empresa.id], p_nombre: 'Efectivo', p_tipo: 'efectivo', p_exige_cuenta_cobro: false, p_genera_deuda: false, p_estado_inicial: 'cobrado' }),
  })
  if (!r.ok) throw new Error(`crear_forma_pago: ${r.status} ${await r.text()}`)
  return { organizacionId: org.id, usuarioId, correo, empresaId: empresa.id, promocionId: promocion.id, nombres, codigos }
}

async function limpiar(s: Siembra | null) {
  if (!s) return
  try {
    await limpiarOrganizacion(s.organizacionId)
  } finally {
    await fetch(`${url}/auth/v1/admin/users/${s.usuarioId}`, { method: 'DELETE', headers: cabeceras() })
  }
}

async function escanear(page: Page, codigo: string) {
  const campo = page.getByLabel('Escaneá o ingresá el código de barras')
  await campo.fill(codigo)
  await campo.press('Enter')
}

test.describe.configure({ mode: 'serial' })

test.describe('Ventas · mostrador con precio promocional (MSF-816, SC-004)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.setTimeout(90_000)

  let banderaPrevia = false
  test.beforeAll(async () => {
    if (url && serviceKey) banderaPrevia = await fijarBandera(false)
  })
  test.afterAll(async () => {
    if (url && serviceKey) await fijarBandera(banderaPrevia).catch((e: unknown) => console.warn('limpieza E2E: bandera', e))
  })

  test('[MSF-816:T012] [FR-016,SC-004] escanear un producto en promoción muestra el tachado y «Promoción», y se cobra al precio promocional', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    let siembra: Siembra | null = null
    try {
      siembra = await sembrar(sufijo, { promo: '7790002000011', normal: '7790002000028' })
      await fijarBandera(true)
      await ingresar(page, siembra.correo)
      await page.goto('/ventas/mostrador')
      await expect(page.getByRole('heading', { name: 'Venta de mostrador' })).toBeVisible()

      await escanear(page, siembra.codigos.promo)
      const tabla = page.getByRole('table', { name: 'Productos de la venta' })
      const fila = tabla.getByRole('row').filter({ hasText: siembra.nombres.promo })
      await expect(fila).toBeVisible()
      await expect(fila.locator('s')).toHaveText('$ 1.000')
      await expect(fila).toContainText('Promoción')
      await expect(fila).toContainText('Precio anterior')
      await expect(fila).toContainText('Precio promocional')
      await expect(fila).toContainText('promoción')
      await expect(fila).not.toContainText('escala x1')
      const totales = page.getByRole('group', { name: 'Totales de la venta' })
      await expect(totales).toContainText('Total: $ 900')
      // Sin aviso de precios: nada cambió entre escaneos.
      await expect(page.getByText(/Los precios cambiaron/)).toHaveCount(0)

      // Cobro al precio promocional (T012).
      await page.getByRole('button', { name: 'Cobrar' }).click()
      await expect(page.getByText(/Venta cobrada/)).toContainText('$ 900')

      const comprobantes = await leer<{ id: string; total_con_iva: number; total_sin_iva: number }>(
        `comprobantes_venta?organizacion_id=eq.${siembra.organizacionId}&select=id,total_con_iva,total_sin_iva`,
      )
      expect(comprobantes).toHaveLength(1)
      const [comprobante] = comprobantes
      const cobros = await leer<{ importe: number }>(`cobros_comprobante?comprobante_id=eq.${comprobante.id}&select=importe`)
      expect(cobros).toHaveLength(1)
      // El total del comprobante y el del cobro coinciden con el precio promocional.
      expect(Number(comprobante.total_con_iva)).toBe(900)
      expect(Number(cobros[0].importe)).toBe(Number(comprobante.total_con_iva))
      const lineas = await leer<{ precio_unitario: number; precio_referencia: number | null; descuento_pct: number }>(
        `comprobantes_venta_lineas?comprobante_id=eq.${comprobante.id}&select=precio_unitario,precio_referencia,descuento_pct`,
      )
      expect(lineas.map((l) => [Number(l.precio_unitario), Number(l.precio_referencia)])).toEqual([[900, 1000]])
    } finally {
      await limpiar(siembra)
    }
  })

  test('[MSF-816:T012] [SC-002] con la bandera apagada el mostrador es el de siempre: precio de lista, sin tachado ni leyenda', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    let siembra: Siembra | null = null
    try {
      siembra = await sembrar(sufijo, { promo: '7790002000035', normal: '7790002000042' })
      await fijarBandera(false)
      await ingresar(page, siembra.correo)
      await page.goto('/ventas/mostrador')
      await escanear(page, siembra.codigos.promo)
      const tabla = page.getByRole('table', { name: 'Productos de la venta' })
      const fila = tabla.getByRole('row').filter({ hasText: siembra.nombres.promo })
      await expect(fila).toBeVisible()
      await expect(fila).toContainText('$ 1.000')
      await expect(fila).toContainText('escala x1')
      await expect(fila.locator('s')).toHaveCount(0)
      await expect(fila).not.toContainText('Promoción')
      await expect(fila).not.toContainText('Precio anterior')
      await expect(page.getByRole('group', { name: 'Totales de la venta' })).toContainText('Total: $ 1.000')
    } finally {
      await limpiar(siembra)
    }
  })

  test('[MSF-816:T012] [FR-017] si la promoción vence entre dos escaneos avisa «Los precios cambiaron» y reprecia la línea', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    let siembra: Siembra | null = null
    try {
      siembra = await sembrar(sufijo, { promo: '7790002000059', normal: '7790002000066' })
      await fijarBandera(true)
      await ingresar(page, siembra.correo)
      await page.goto('/ventas/mostrador')
      await escanear(page, siembra.codigos.promo)
      const tabla = page.getByRole('table', { name: 'Productos de la venta' })
      const fila = tabla.getByRole('row').filter({ hasText: siembra.nombres.promo })
      await expect(fila.locator('s')).toHaveText('$ 1.000')

      // La promoción vence con la venta abierta (el servidor la deja de ver al guardar el siguiente escaneo).
      const r = await fetch(`${url}/rest/v1/promociones_precio?id=eq.${siembra.promocionId}`, {
        method: 'PATCH',
        headers: cabeceras({ 'content-profile': 'dominio' }),
        body: JSON.stringify({ hasta: new Date(Date.now() - 60_000).toISOString() }),
      })
      expect(r.ok, await r.clone().text()).toBe(true)

      await escanear(page, siembra.codigos.normal)
      await expect(tabla.getByRole('row').filter({ hasText: siembra.nombres.normal })).toBeVisible()
      const aviso = page.getByRole('status').filter({ hasText: 'Los precios cambiaron: revisá el total' })
      await expect(aviso).toBeVisible()
      // La línea de la promoción vencida vuelve al precio normal, sin tachado, y el total la refleja (1.000 + 500).
      await expect(fila.locator('s')).toHaveCount(0)
      await expect(fila).not.toContainText('Promoción')
      await expect(fila).toContainText('$ 1.000')
      await expect(page.getByRole('group', { name: 'Totales de la venta' })).toContainText('Total: $ 1.500')
      // Es informativo: el lector sigue habilitado.
      await expect(page.getByLabel('Escaneá o ingresá el código de barras')).toBeEnabled()
    } finally {
      await limpiar(siembra)
    }
  })
})
