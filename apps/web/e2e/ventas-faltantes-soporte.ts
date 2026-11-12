import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect } from './fixture'
import { clic, escribir } from './visible'

// Soporte de los E2E de avisos de faltantes (F-VTA-26 y F-VTA-27 · épica MSF-161). Requiere el stack local
// (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key nunca llega
// al navegador), como `ingresos-mercaderia.e2e.ts` y `ventas-rma.e2e.ts`. Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY los E2E se omiten.
export const url = process.env.SUPABASE_URL
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de faltantes: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

export async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

export async function leer<T>(ruta: string, esquema = 'dominio'): Promise<T[]> {
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

export type FaltanteSembrado = { cliente: string; producto: string; cantidad: number; correo: string | null }

export type Sembrado = {
  sufijo: string
  correo: string
  orgId: string
  idUsuario: string
  empresa: string
  proveedor: string
  productos: Record<string, string>
}

// Organización con administrador, tienda y depósito; un producto por nombre; y un faltante abierto por cada
// `FaltanteSembrado` (factura confirmada del cliente + fila en `dominio.faltantes_venta`, que el despacho real
// escribe con `registrar_faltantes_despacho`). `correo: null` es un cliente sin correo.
export async function sembrar(prefijo: string, faltantes: FaltanteSembrado[]): Promise<Sembrado> {
  const sufijo = randomUUID().slice(0, 8)
  const correo = `admin-${prefijo}-${sufijo}@example.com`
  const empresaNombre = `Tienda ${prefijo} ${sufijo}`
  const proveedor = `Proveedor ${prefijo} ${sufijo}`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E ${prefijo} ${sufijo}` })
  const datos: Sembrado = { sufijo, correo, orgId: org.id, idUsuario: '', empresa: empresaNombre, proveedor, productos: {} }
  try {
    const [deposito] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`)
    datos.idUsuario = await altaUsuario(correo)
    await rest('usuarios_organizacion', [{ user_id: datos.idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
    const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: empresaNombre, activa: true }, 'dominio')
    await rest('depositos_empresas', [{ deposito_id: deposito.id, empresa_id: empresa.id, organizacion_id: org.id }], 'dominio')
    await rest('proveedores', { organizacion_id: org.id, razon_social: proveedor, cuit: '20123456786', activo: true }, 'dominio')

    const token = await tokenDe(correo)
    let numero = 0
    for (const faltante of faltantes) {
      numero += 1
      if (!datos.productos[faltante.producto]) {
        const [producto] = await rest<{ id: string }>('productos', {
          organizacion_id: org.id, nombre: faltante.producto, sku: `E2E-${prefijo}-${numero}-${sufijo}`, moneda: 'ARS', precio_lista: 100,
        }, 'dominio')
        datos.productos[faltante.producto] = producto.id
        // El disparador `productos_crear_existencias` ya crea la fila: se actualiza con upsert.
        await rest('existencias?on_conflict=producto_id', [{ producto_id: producto.id, organizacion_id: org.id, cantidad: 50, reservado: 0 }], 'dominio', 'return=representation,resolution=merge-duplicates')
        await rest('existencias_deposito', [{ producto_id: producto.id, deposito_id: deposito.id, organizacion_id: org.id, cantidad: 50, reservado: 0 }], 'dominio')
      }
      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id, nombre: faltante.cliente, tipo: 'minorista', archivado_en: null, correo: faltante.correo,
      })
      const comprobante = await rpc<{ id: string; updated_at: string }>(token, 'crear_comprobante', {
        p_tipo: 'factura', p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_canal: 'mostrador',
        p_fecha: new Date().toISOString().slice(0, 10),
      })
      await rpc(token, 'guardar_lineas_comprobante', {
        p_id: comprobante.id,
        p_lineas: [{ producto_id: datos.productos[faltante.producto], cantidad: faltante.cantidad, deposito_id: deposito.id }],
        p_actualizado_en: comprobante.updated_at,
      })
      await rpc(token, 'confirmar_comprobante', { p_id: comprobante.id })
      await rest('faltantes_venta', {
        organizacion_id: org.id, empresa_id: empresa.id, comprobante_id: comprobante.id, linea_orden: 1,
        producto_id: datos.productos[faltante.producto], deposito_id: deposito.id, cantidad_faltante: faltante.cantidad,
      }, 'dominio')
    }
    return datos
  } catch (error) {
    await limpiar(datos)
    throw error
  }
}

// Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
export async function limpiar(datos: Sembrado) {
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  if (datos.idUsuario) await borrarUsuario(datos.idUsuario)
}

export async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

// Corre axe-core en la página real (WCAG 2 A/AA); devuelve las violaciones legibles.
export async function violacionesAxe(page: Page): Promise<string[]> {
  const ruta = createRequire(import.meta.url).resolve('axe-core')
  await page.addScriptTag({ path: ruta })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } }).axe
    const resultado = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
    return resultado.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  })
}

export const ANCHOS = [320, 768, 1440]

// Sin desborde horizontal de la página.
export async function desborde(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
