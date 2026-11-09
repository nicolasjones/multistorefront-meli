import { expect, test } from './fixture'

// F-CLI-19 (MSF-451, FR-005, SC-003): la ficha del cliente muestra el «Saldo deudor» y la
// «Cuenta corriente» con los comprobantes que tienen saldo.
// Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web
// servida; usa la persona de ejemplo del seed. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md. La service-role key solo
// lee el identificador del cliente de ejemplo (nunca llega al navegador).
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key lee datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de cuenta corriente: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = () => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  accept: 'application/json',
})

// El cliente de ejemplo del seed (`supabase/seed.sql`): número 9100, con facturas en las dos
// tiendas, cobros parciales, uno total y una sin cobrar.
const NUMERO_CLIENTE = 9100

async function idCliente(): Promise<string> {
  const r = await fetch(`${url}/rest/v1/clientes?numero=eq.${NUMERO_CLIENTE}&select=id`, { headers: cabeceras() })
  if (!r.ok) throw new Error(`REST clientes: ${r.status} ${await r.text()}`)
  const filas = (await r.json()) as { id: string }[]
  if (filas.length !== 1) throw new Error(`El seed no dejó un solo cliente con número ${NUMERO_CLIENTE}.`)
  return filas[0].id
}

test.describe('Clientes · cuenta corriente y saldo del cliente (F-CLI-19)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-451:T001] la ficha del cliente muestra el saldo deudor y los comprobantes con saldo', async ({ page }) => {
    const clienteId = await idCliente()

    await page.goto('/login')
    await page.getByLabel('Correo').fill('ventas@local.test')
    await page.getByLabel('Contraseña').fill('Ventas-Local1!')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).not.toHaveURL(/\/login/)

    await page.goto(`/clientes/show/${clienteId}`)

    // El «Saldo deudor» de la tarjeta «Resumen comercial»: la suma de los saldos abiertos.
    await expect(page.getByRole('heading', { name: 'Resumen comercial' })).toBeVisible()
    const saldo = page.getByText('Saldo deudor').locator('..')
    await expect(saldo).toContainText('$ 220.000')

    // La cuenta corriente: los cuatro comprobantes con saldo del cliente de ejemplo.
    const tabla = page.getByRole('table', { name: 'Comprobantes con saldo del cliente' })
    await expect(tabla).toBeVisible()
    await expect(tabla.getByRole('row')).toHaveCount(5)
    await expect(tabla.getByRole('columnheader', { name: 'Saldo' })).toBeVisible()
  })
})
