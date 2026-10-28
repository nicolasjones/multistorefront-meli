import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso } from './visible'

// Evidencia de MSF-288 (F-VTA-28, US1, SC-002): factura confirmada → «Nueva devolución» → RMA registrado con su
// número y su ítem → aparece en el listado. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra
// con la API admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no corre en el CI público). Ver docs/ventas-rma-devoluciones.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-rma: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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
  if (!r.ok) throw new Error(`REST GET ${ruta}: ${r.status} ${await r.text()}`)
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

async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

async function rpc<T>(token: string, funcion: string, argumentos: unknown): Promise<T> {
  const r = await fetch(`${url}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: cabeceras({ authorization: `Bearer ${token}` }),
    body: JSON.stringify(argumentos),
  })
  if (!r.ok) throw new Error(`RPC ${funcion}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Devoluciones (RMA) por ítem (MSF-288, F-VTA-28)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-288:T009] factura confirmada → alta de la devolución → número, ítem y listado', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-rma-${sufijo}@example.com`
    const nombreCliente = `Cliente RMA ${sufijo}`
    const nombreProducto = `Producto RMA ${sufijo}`
    let orgId: string | undefined
    let idUsuario: string | undefined

    try {
      // Siembra: organización (crea el depósito principal), administrador, empresa, cliente, producto y stock.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E RMA ${sufijo}` })
      orgId = org.id
      const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`)
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda RMA ${sufijo}`, activa: true }, 'dominio')
      await rest('depositos_empresas', [{ deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }], 'dominio')
      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id, numero: 1, nombre: nombreCliente, tipo: 'minorista', archivado_en: null,
      })
      const [producto] = await rest<{ id: string }>('productos', {
        organizacion_id: org.id, nombre: nombreProducto, sku: `E2E-RMA-${sufijo}`, moneda: 'ARS', precio_lista: 100,
      }, 'dominio')
      await rest('existencias', [{ producto_id: producto.id, organizacion_id: org.id, cantidad: 5, reservado: 0 }], 'dominio')
      await rest('existencias_deposito', [{ producto_id: producto.id, deposito_id: deposito.id, organizacion_id: org.id, cantidad: 5, reservado: 0 }], 'dominio')

      // Factura confirmada con una línea de 2 unidades: el RMA se registra sobre ella.
      const token = await tokenDe(correo)
      const comprobante = await rpc<{ id: string; numero: string; updated_at: string }>(token, 'crear_comprobante', {
        p_tipo: 'factura', p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_canal: 'mostrador',
        p_fecha: new Date().toISOString().slice(0, 10),
      })
      await rpc(token, 'guardar_lineas_comprobante', {
        p_id: comprobante.id,
        p_lineas: [{ producto_id: producto.id, cantidad: 2, deposito_id: deposito.id }],
        p_actualizado_en: comprobante.updated_at,
      })
      await rpc(token, 'confirmar_comprobante', { p_id: comprobante.id })

      const { contexto, page } = await abrirContextoGrabado(browser, testInfo)
      try {
        await ingresar(page, correo)
        await paso(page, 'Abre Devoluciones (RMA)', async () => {
          await page.goto('/ventas/devoluciones')
          await expect(page.getByRole('heading', { name: 'Devoluciones (RMA)', level: 1 })).toBeVisible()
        })

        await paso(page, 'Abre «Nueva devolución»', async () => {
          await clic(page, page.getByRole('button', { name: 'Nueva devolución' }))
          await expect(page.getByRole('dialog', { name: 'Nueva devolución' })).toBeVisible()
        })

        const dialogo = page.getByRole('dialog', { name: 'Nueva devolución' })
        await paso(page, 'Elige la factura vendida', async () => {
          await clic(page, dialogo.getByLabel('Comprobante'))
          await clic(page, page.getByRole('option', { name: new RegExp(comprobante.numero) }))
        })
        await paso(page, 'Elige el ítem a devolver', async () => {
          await clic(page, dialogo.getByLabel('Ítem'))
          await clic(page, page.getByRole('option', { name: new RegExp(nombreProducto) }))
        })
        await paso(page, 'Completa forma, motivo y observaciones', async () => {
          await dialogo.getByRole('radio', { name: /Enviado a proveedor/ }).check()
          await escribir(page, dialogo.getByLabel('Motivo'), 'No enciende')
          await escribir(page, dialogo.getByLabel('Observaciones'), 'Lo revisa el proveedor')
        })

        await paso(page, 'Registra la devolución', async () => {
          await clic(page, dialogo.getByRole('button', { name: 'Registrar devolución' }))
          await expect(page.getByText('Devolución registrada · Enviado a proveedor')).toBeVisible()
        })

        await paso(page, 'El RMA queda en el listado con su número y su ítem', async () => {
          await expect(dialogo).toBeHidden()
          await expect(page.getByText('RMA-0001')).toBeVisible()
          await expect(page.getByText(nombreProducto).first()).toBeVisible()
          await expect(page.getByText(nombreCliente).first()).toBeVisible()
        })
      } finally {
        await contexto.close()
      }
    } finally {
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
