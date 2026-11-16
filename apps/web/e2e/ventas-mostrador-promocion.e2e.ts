import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { CONTRASENA_E2E, altaUsuario, borrarUsuario, cabeceras, leer, rest, serviceKey, url } from './soporte/fixtures'

// MSF-816 (gate MSF-834, F-2, SC-004): en la Venta de mostrador, un producto en promoción se escanea al
// precio promocional (con el precio anterior tachado y la leyenda «Promoción») y se cobra a ese precio; si la
// promoción cambia entre el escaneo y el cobro, el cobro se rechaza con aviso y la venta se reprecia.
// Requiere el stack local (`pnpm dev:supabase`); siembra con la API admin desde Node (la service-role key nunca
// llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público).
// Comparte la bandera global `promociones_precio` con los specs de la tienda: corre con `--workers=1`.


const cabecerasDominio = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

// MSF-363 (decisión 15): la bandera `promociones_precio` nace APAGADA; el E2E la enciende y devuelve el valor
// previo al terminar (es global: el mismo mecanismo usa `tienda-promocion.e2e.ts`).
async function fijarBandera(clave: string, activa: boolean): Promise<boolean> {
  const ruta = `banderas_plataforma?clave=eq.${clave}`
  const l = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const previa = l.ok ? ((await l.json()) as { activa: boolean }[])[0]?.activa ?? false : false
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': 'public' }),
    body: JSON.stringify({ activa }),
  })
  if (!r.ok) throw new Error(`bandera ${clave}: ${r.status} ${await r.text()}`)
  return previa
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(CONTRASENA_E2E)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const DIA = 24 * 60 * 60 * 1000

test.describe('Ventas · mostrador con precio promocional (MSF-816, SC-004)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-834:T012] escanea al precio promocional, cobra ese precio y avisa si la promoción cambia', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-promocion-${sufijo}@example.com`
    const codigo = '7790002000011'
    const nombreProducto = `Joystick promo ${sufijo}`
    let banderaPrevia = false
    let organizacionId: string | null = null
    let usuarioId: string | null = null
    try {
      banderaPrevia = await fijarBandera('promociones_precio', true)
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E promo ${sufijo}` })
      organizacionId = org.id
      const [empresa] = await rest<{ id: string }>(
        'empresas',
        { organizacion_id: org.id, nombre: `Tienda Promo ${sufijo}`, razon_social: `Tienda ${sufijo} SRL`, cuit: '30712345679' },
        'dominio',
      )
      usuarioId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: usuarioId, organizacion_id: org.id, rol_id: 'administrador' })
      // Empresa activa: sin ella el usuario entra en «Todas mis empresas» y la pantalla pide elegir una tienda.
      await rest('usuario_empresa_activa', { user_id: usuarioId, empresa_id: empresa.id })

      // Producto de lista $ 1.000 con código de barras y el depósito principal de la tienda.
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: nombreProducto, sku: `JOY-${sufijo}`, moneda: 'ARS', precio_lista: 1000, codigo_barras: codigo },
        'dominio',
      )
      await rest('producto_empresa', { producto_id: producto.id, empresa_id: empresa.id, organizacion_id: org.id }, 'dominio')
      const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`, 'dominio')
      await rest('depositos_empresas', { deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }, 'dominio')

      // Promoción vigente de $ 800 (sin IVA) sobre el producto de la tienda.
      const ahora = Date.now()
      const [promocion] = await rest<{ id: string }>(
        'promociones_precio',
        {
          organizacion_id: org.id,
          empresa_id: empresa.id,
          producto_id: producto.id,
          precio_promocional: 800,
          desde: new Date(ahora - DIA).toISOString(),
          hasta: new Date(ahora + DIA).toISOString(),
        },
        'dominio',
      )

      await ingresar(page, correo)
      await page.goto('/ventas/mostrador')
      await expect(page.getByRole('heading', { name: 'Venta de mostrador' })).toBeVisible()

      // Escaneo: la línea sale al precio promocional, con el precio anterior tachado y la leyenda «Promoción».
      const campo = page.getByLabel('Escaneá o ingresá el código de barras')
      await campo.fill(codigo)
      await campo.press('Enter')
      const tabla = page.getByRole('table', { name: 'Productos de la venta' })
      await expect(tabla.getByRole('cell').nth(0)).toContainText('Promoción')
      await expect(tabla.getByRole('cell').nth(2)).toContainText('$ 800')
      await expect(tabla.getByRole('cell').nth(2).locator('del')).toHaveText('$ 1.000')

      // La promoción cambia entre el escaneo y el cobro: el cobro se rechaza con aviso y la venta se reprecia.
      const cambio = await fetch(`${url}/rest/v1/promociones_precio?id=eq.${promocion.id}`, {
        method: 'PATCH',
        headers: cabecerasDominio(),
        body: JSON.stringify({ precio_promocional: 700 }),
      })
      if (!cambio.ok) throw new Error(`PATCH promociones_precio: ${cambio.status} ${await cambio.text()}`)

      await page.getByRole('button', { name: 'Cobrar' }).click()
      await expect(page.getByText(/Los precios cambiaron: revisá el total y cobrá de nuevo/)).toBeVisible()
      await expect(tabla.getByRole('cell').nth(2)).toContainText('$ 700')
      await expect(tabla.getByRole('cell').nth(2).locator('del')).toHaveText('$ 1.000')

      // Cobrar de nuevo: el importe cobrado es el total del comprobante ya repreciado.
      const total = await page.getByRole('group', { name: 'Totales de la venta' }).textContent()
      const importe = /Total: \$ ([\d.,]+)/.exec(total ?? '')?.[1] ?? ''
      await page.getByRole('button', { name: 'Cobrar' }).click()
      await expect(page.getByText(/Venta cobrada/)).toContainText(`$ ${importe}`)
    } finally {
      try {
        await fijarBandera('promociones_precio', banderaPrevia).catch((e: unknown) => console.warn('limpieza E2E: bandera', e))
        if (organizacionId) await fetch(`${url}/rest/v1/organizaciones?id=eq.${organizacionId}`, { method: 'DELETE', headers: cabeceras() })
      } finally {
        if (usuarioId) await borrarUsuario(usuarioId)
      }
    }
  })
})
