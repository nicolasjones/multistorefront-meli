// Semillas y helpers compartidos de los E2E con sesión contra el Supabase LOCAL
// (`pnpm dev:supabase`): alta de organización, usuarios por rol y productos con la
// service-role key (que nunca llega al navegador), movimientos por API y limpieza.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los archivos que lo usan se omiten.
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect } from './fixture'
import { clic, escribir } from './visible'

export const url = process.env.SUPABASE_URL
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
export const hayStack = Boolean(url && serviceKey)
export const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

export const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

export async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

export async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
  if (!r.ok) throw new Error(`REST GET ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

export async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

export async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

export async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

/** Ingreso por la pantalla, con mouse visible en modo evidencia. */
export async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

/** Token de sesión de un usuario sembrado (para llamar RPC como esa persona, sin pantalla). */
export async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

export type Rol = 'administrador' | 'operador' | 'consulta'
export type Tipo = 'entrada' | 'salida' | 'ajuste'

export interface Siembra {
  orgId: string
  usuarios: Record<string, { id: string; correo: string }>
  productos: Array<{ id: string; nombre: string }>
  /** Llama la RPC de stock como `rol` (sin pantalla). Devuelve la respuesta cruda. */
  moverStock: (rol: Rol, productoId: string, tipo: Tipo, cantidad: number, motivo?: string) => Promise<Response>
  limpiar: () => Promise<void>
}

/** Organización con un usuario por rol pedido y N productos (existencias en 0). */
export async function sembrarStock(prefijo: string, roles: Rol[], nombresProductos: string[]): Promise<Siembra> {
  const sufijo = randomUUID().slice(0, 8)
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E ${prefijo} ${sufijo}` })
  const usuarios: Siembra['usuarios'] = {}
  for (const rol of roles) {
    const correo = `${rol}-${prefijo}-${sufijo}@example.com`
    const id = await altaUsuario(correo)
    usuarios[rol] = { id, correo }
    await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: rol }])
  }
  const productos: Siembra['productos'] = []
  for (const [i, base] of nombresProductos.entries()) {
    const nombre = `${base} ${sufijo}`
    const [p] = await rest<{ id: string }>('productos', { organizacion_id: org.id, nombre, sku: `E2E-${sufijo}-${i}`, precio_lista: 10 }, 'dominio')
    productos.push({ id: p.id, nombre })
  }
  const motivos = await leer<{ id: string; nombre: string; aplica_a: string[] }>(
    `motivos_movimiento?organizacion_id=eq.${org.id}&activo=eq.true&select=id,nombre,aplica_a`,
    'dominio',
  )
  const tokens = new Map<string, string>()
  const moverStock: Siembra['moverStock'] = async (rol, productoId, tipo, cantidad, motivo) => {
    const correo = usuarios[rol].correo
    if (!tokens.has(correo)) tokens.set(correo, await tokenDe(correo))
    const elegido = (motivo ? motivos.find((m) => m.nombre === motivo) : undefined) ?? motivos.find((m) => m.aplica_a.includes(tipo))
    return fetch(`${url}/rest/v1/rpc/registrar_movimiento_stock`, {
      method: 'POST',
      headers: cabeceras({ authorization: `Bearer ${tokens.get(correo)}` }),
      body: JSON.stringify({
        p_producto: productoId,
        p_tipo: tipo,
        p_cantidad: cantidad,
        p_motivo: elegido?.id,
        p_nota: null,
        p_fecha: new Date().toISOString().slice(0, 10),
      }),
    })
  }
  return {
    orgId: org.id,
    usuarios,
    productos,
    moverStock,
    limpiar: async () => {
      // El Supabase local no acumula organizaciones ni usuarios sembrados.
      await borrar(`usuarios_organizacion?organizacion_id=eq.${org.id}`)
      await borrar(`organizaciones?id=eq.${org.id}`)
      for (const u of Object.values(usuarios)) await borrarUsuario(u.id)
    },
  }
}
