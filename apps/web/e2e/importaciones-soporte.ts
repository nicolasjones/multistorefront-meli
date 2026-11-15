import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect } from './fixture'
import { clic, escribir } from './visible'

// Soporte de los E2E del centro de importaciones (F-IMP-01 · MSF-354). Requiere el stack local
// (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key
// nunca llega al navegador). Los procesos de prueba nacen por las funciones de la base: el pendiente
// por `iniciar_proceso_masivo` con la sesión del administrador; los demás estados, con la siembra.
export const url = process.env.SUPABASE_URL
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de importaciones: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', extra: Record<string, string> = {}): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation', 'content-profile': esquema, ...extra }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
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

// Sesión del administrador para llamar a las funciones de la app como lo haría la pantalla.
async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`login de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

export type Sembrado = {
  orgId: string
  correo: string
  empresaA: { id: string; nombre: string }
  empresaB: { id: string; nombre: string }
  nombres: { pendiente: string; en_curso: string; con_errores: string }
  idsUsuario: string[]
}

const haceSegundos = (segundos: number) => new Date(Date.now() - segundos * 1000).toISOString()

export async function sembrar(sufijo: string): Promise<Sembrado> {
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E importaciones ${sufijo}` })
  const [empresaA, empresaB] = (
    await rest<{ id: string; nombre: string }>(
      'empresas',
      [
        { organizacion_id: org.id, nombre: `Tienda A ${sufijo}`, activa: true },
        { organizacion_id: org.id, nombre: `Tienda B ${sufijo}`, activa: true },
      ],
      'dominio',
    )
  ).map((e) => ({ id: e.id, nombre: e.nombre }))
  const correo = `admin-imp-${sufijo}@example.com`
  const idAdmin = await altaUsuario(correo)
  await rest('usuarios_organizacion', [{ user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' }])

  // Conexión y capacidad del ciclo de ejecuciones, para que `iniciar_proceso_masivo` tenga dónde colgar.
  await rest('sistemas_externos', { id: 'procesos-prueba', descripcion: 'Sistema de prueba de procesos masivos' }, 'public', {
    prefer: 'resolution=ignore-duplicates,return=minimal',
  }).catch(() => undefined)
  const [conexion] = await rest<{ id: string }>('conexiones', {
    organizacion_id: org.id,
    sistema_externo: 'procesos-prueba',
    credencial_vault_id: randomUUID(),
  })
  await rest('capacidades_ejecucion', { organizacion_id: org.id, conexion_id: conexion.id, clave: 'importar-prueba', tiempo_max_seg: 3600 })

  const nombres = {
    pendiente: `Carga pendiente ${sufijo}`,
    en_curso: `Descarga en curso ${sufijo}`,
    con_errores: `Carga con errores ${sufijo}`,
  }

  // Pendiente: nace por la función de la app, con su ejecución y su orden de despacho.
  const token = await tokenDe(correo)
  const r = await fetch(`${url}/rest/v1/rpc/iniciar_proceso_masivo`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_conexion_id: conexion.id,
      p_capacidad: 'importar-prueba',
      p_tipo: 'importacion',
      p_funcionalidad: 'catalogo',
      p_nombre: nombres.pendiente,
      p_empresa_id: empresaA.id,
    }),
  })
  if (!r.ok) throw new Error(`RPC iniciar_proceso_masivo: ${r.status} ${await r.text()}`)

  // En curso (con avance) en la tienda B y terminado con errores sin empresa: los deja el «worker».
  await rest('procesos_masivos', {
    organizacion_id: org.id,
    empresa_id: empresaB.id,
    tipo: 'exportacion',
    funcionalidad: 'exportacion-total',
    nombre: nombres.en_curso,
    estado: 'en_curso',
    total: 100,
    procesados: 40,
    solicitado_por: idAdmin,
    creado_en: haceSegundos(120),
    iniciado_en: haceSegundos(110),
  })
  const [conErrores] = await rest<{ id: string }>('procesos_masivos', {
    organizacion_id: org.id,
    empresa_id: null,
    tipo: 'importacion',
    funcionalidad: 'mercado-libre',
    nombre: nombres.con_errores,
    estado: 'con_errores',
    total: 10,
    procesados: 10,
    con_errores: 2,
    solicitado_por: idAdmin,
    creado_en: haceSegundos(300),
    iniciado_en: haceSegundos(290),
    finalizado_en: haceSegundos(200),
  })
  await rest('procesos_masivos_errores', [
    { proceso_id: conErrores.id, organizacion_id: org.id, fila: 3, referencia: 'MLA-100', motivo_sanitizado: 'Precio inválido' },
    { proceso_id: conErrores.id, organizacion_id: org.id, fila: 7, referencia: 'MLA-200', motivo_sanitizado: 'Falta el título' },
  ])

  return { orgId: org.id, correo, empresaA, empresaB, nombres, idsUsuario: [idAdmin] }
}

export async function limpiar(datos: Sembrado) {
  await borrar(`usuario_empresa_activa?user_id=in.(${datos.idsUsuario.join(',')})`)
  await borrar(`procesos_masivos?organizacion_id=eq.${datos.orgId}`)
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`empresas?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  for (const id of datos.idsUsuario) await borrarUsuario(id)
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
