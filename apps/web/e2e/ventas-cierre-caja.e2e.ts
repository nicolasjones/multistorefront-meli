import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// Evidencia de MSF-349 (F-VTA-33, US3, SC-003, CA-VTA-33-1): un día con cobros → «Cerrar caja» → resumen por forma de pago y
// cuenta → el cobro del día se rechaza → «Reabrir» → el cobro se registra. Requiere el stack local (`pnpm dev:supabase`) y la web
// servida; siembra con la API admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no corre en el CI público). Ver docs/ventas-cierre-caja.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-cierre-caja: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

test.describe('Cierre de caja diario (MSF-349, F-VTA-33)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-349:T021] [F-VTA-33#1] cerrar la caja del día resume los cobros y bloquea modificarlos hasta reabrirla', async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-caja-${sufijo}@example.com`
    let orgId: string | undefined
    let idUsuario: string | undefined

    try {
      // Siembra: organización, administrador, empresa, cliente, forma de pago en efectivo y una factura confirmada.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E Caja ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda Caja ${sufijo}`, activa: true }, 'dominio')
      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id, numero: 1, nombre: `Cliente Caja ${sufijo}`, tipo: 'minorista', archivado_en: null,
      })
      const [forma] = await rest<{ id: string }>('formas_pago', {
        organizacion_id: org.id, empresa_id: empresa.id, nombre: 'Efectivo', tipo: 'efectivo',
        exige_cuenta_cobro: false, genera_deuda: false, activo: true,
      }, 'dominio')
      const [factura] = await rest<{ id: string }>('comprobantes_venta', {
        organizacion_id: org.id, empresa_id: empresa.id, cliente_id: cliente.id, tipo: 'factura', numero: '0001-00000001',
        fecha: new Date().toISOString().slice(0, 10), estado: 'confirmada', total_sin_iva: 1000, total_con_iva: 1000,
        confirmado_en: new Date().toISOString(),
      }, 'dominio')
      const token = await tokenDe(correo)
      await rpc(token, 'registrar_cobro', { p_comprobante_id: factura.id, p_importe: 400, p_forma_pago_id: forma.id })

      const { contexto, page } = await abrirContextoGrabado(browser, testInfo)
      try {
        await prepararPaginaVisible(page)
        await ingresar(page, correo)
        await paso(page, 'Abre Cierre de caja', async () => {
          await page.goto('/ventas/cierre-caja')
          await expect(page.getByRole('heading', { name: 'Cierre de caja', level: 1 })).toBeVisible()
          await expect(page.getByText('Sin cierres de caja')).toBeVisible()
        })
        await paso(page, 'Cierra la caja del día', async () => {
          await clic(page, page.getByRole('button', { name: 'Cerrar caja' }))
          const dialogo = page.getByRole('dialog', { name: 'Cerrar caja' })
          await expect(dialogo).toBeVisible()
          await clic(page, dialogo.getByRole('button', { name: 'Cerrar caja' }))
          await expect(page.getByText(/Caja cerrada · Tienda Caja/)).toBeVisible()
        })
        await rotulo(page, 'El cierre queda resumido por forma de pago')
        await paso(page, 'El cierre muestra su estado y el detalle', async () => {
          await expect(page.getByText('Cerrada', { exact: true })).toBeVisible()
          await expect(page.getByText(/Efectivo: \$\s*400/)).toBeVisible()
        })
        await paso(page, 'Con la caja cerrada no se puede registrar un cobro', async () => {
          const respuesta = await fetch(`${url}/rest/v1/rpc/registrar_cobro`, {
            method: 'POST',
            headers: cabeceras({ authorization: `Bearer ${token}` }),
            body: JSON.stringify({ p_comprobante_id: factura.id, p_importe: 100, p_forma_pago_id: forma.id }),
          })
          expect(respuesta.status).toBeGreaterThanOrEqual(400)
          expect(await respuesta.text()).toContain('55000')
        })
        await paso(page, 'Reabre la caja', async () => {
          await clic(page, page.getByRole('button', { name: /Reabrir la caja de Tienda Caja/ }))
          const dialogo = page.getByRole('dialog', { name: 'Reabrir caja' })
          await clic(page, dialogo.getByRole('button', { name: 'Reabrir' }))
          await expect(page.getByText(/Caja reabierta · Tienda Caja/)).toBeVisible()
          await expect(page.getByText('Reabierta', { exact: true })).toBeVisible()
        })
        await paso(page, 'Con la caja reabierta el cobro se registra', async () => {
          await rpc(token, 'registrar_cobro', { p_comprobante_id: factura.id, p_importe: 100, p_forma_pago_id: forma.id })
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
