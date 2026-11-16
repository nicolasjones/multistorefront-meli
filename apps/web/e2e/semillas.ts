// Semillas y helpers compartidos de los E2E con sesión contra el Supabase LOCAL
// (`pnpm dev:supabase`): alta de organización, usuarios por rol y productos con la
// service-role key (que nunca llega al navegador), movimientos por API y limpieza.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los archivos que lo usan se omiten.
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect } from './fixture'
import { clic, escribir } from './visible'
import { altaUsuario, borrar, borrarUsuario, cabeceras, leer, rest, serviceKey, url } from './soporte/fixtures'

// Los helpers de la API admin viven en `soporte/fixtures.ts` (con el guard de Supabase local); se re-exportan para los
// archivos que ya importan todo de acá.
export { altaUsuario, borrar, borrarUsuario, cabeceras, leer, rest, serviceKey, url }
export const hayStack = Boolean(url && serviceKey)
export const password = 'Correcta-12345!'

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
