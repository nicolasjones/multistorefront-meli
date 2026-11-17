import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect } from './fixture'
import { altaUsuario, borrar, borrarUsuario, CONTRASENA_E2E, rest, serviceKey, sql, TOPE_FETCH_MS, url } from './soporte/fixtures'
import { clic } from './visible'

// Soporte de los E2E del centro de importaciones (F-IMP-01 · MSF-354). Requiere el stack local
// (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key
// nunca llega al navegador) sobre el fixture compartido (`soporte/fixtures.ts`). Los procesos de prueba nacen por las
// funciones de la base: el pendiente por `iniciar_proceso_masivo` con la sesión del administrador; los demás estados,
// con la siembra. `service_role` NO tiene grant sobre `conexiones`, `capacidades_ejecucion`, `sistemas_externos`,
// `procesos_masivos` ni `procesos_masivos_errores` (la REST responde 42501): esas filas se siembran y se limpian con `sql()`.
export { serviceKey, url }
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
// Contraseña fija de los E2E (`CONTRASENA_E2E`): `ayuda` y `panel-sin-desborde` dan de alta a su gente con ese literal y entran con
// `ingresar` de este archivo, así que no puede ser aleatoria sin tocarlos (son usuarios efímeros de un stack efímero).
const password = CONTRASENA_E2E

// Sesión del administrador para llamar a las funciones de la app como lo haría la pantalla.
async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
    signal: AbortSignal.timeout(TOPE_FETCH_MS),
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

/** Fila de `public.sistemas_externos` (referencia de las conexiones) sin pisar la que ya exista. Solo siembra. */
export async function sistemaExterno(id: string, descripcion: string) {
  await sql('insert into public.sistemas_externos (id, descripcion) values ($1, $2) on conflict (id) do nothing', [id, descripcion])
}

/** Conexión de la organización con un sistema externo (sin grant para `service_role`). Devuelve su id. */
export async function conexionDe(orgId: string, sistema: string): Promise<string> {
  const [conexion] = await sql<{ id: string }>('insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id) values ($1, $2, $3) returning id', [orgId, sistema, randomUUID()])
  return conexion.id
}

/** Proceso masivo sembrado como lo deja el «worker» (sin grant para `service_role`): inserta las columnas dadas y devuelve su id. */
async function insertarProceso(campos: Record<string, unknown>): Promise<{ id: string }> {
  const columnas = Object.keys(campos)
  if (!columnas.every((columna) => /^[a-z_]+$/.test(columna))) throw new Error('insertarProceso: nombre de columna inválido')
  const [fila] = await sql<{ id: string }>(
    `insert into public.procesos_masivos (${columnas.map((columna) => `"${columna}"`).join(', ')}) values (${columnas.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(campos),
  )
  return fila
}

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
  const idAdmin = await altaUsuario(correo, password)
  await rest('usuarios_organizacion', [{ user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' }])

  // Conexión y capacidad del ciclo de ejecuciones, para que `iniciar_proceso_masivo` tenga dónde colgar.
  await sistemaExterno('procesos-prueba', 'Sistema de prueba de procesos masivos')
  const conexionId = await conexionDe(org.id, 'procesos-prueba')
  await sql('insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg) values ($1, $2, $3, $4)', [org.id, conexionId, 'importar-prueba', 3600])

  const nombres = {
    pendiente: `Carga pendiente ${sufijo}`,
    en_curso: `Descarga en curso ${sufijo}`,
    con_errores: `Carga con errores ${sufijo}`,
  }

  // Pendiente: nace por la función de la app, con su ejecución y su orden de despacho.
  const token = await tokenDe(correo)
  const r = await fetch(`${url}/rest/v1/rpc/iniciar_proceso_masivo`, {
    method: 'POST',
    signal: AbortSignal.timeout(TOPE_FETCH_MS),
    headers: { apikey: anonKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_conexion_id: conexionId,
      p_capacidad: 'importar-prueba',
      p_tipo: 'importacion',
      p_funcionalidad: 'catalogo',
      p_nombre: nombres.pendiente,
      p_empresa_id: empresaA.id,
    }),
  })
  if (!r.ok) throw new Error(`RPC iniciar_proceso_masivo: ${r.status} ${await r.text()}`)

  // En curso (con avance) en la tienda B y terminado con errores sin empresa: los deja el «worker».
  await insertarProceso({
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
  const conErrores = await insertarProceso({
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
  await sql(
    `insert into public.procesos_masivos_errores (proceso_id, organizacion_id, fila, referencia, motivo_sanitizado)
     values ($1, $2, 3, 'MLA-100', 'Precio inválido'), ($1, $2, 7, 'MLA-200', 'Falta el título')`,
    [conErrores.id, org.id],
  )

  return { orgId: org.id, correo, empresaA, empresaB, nombres, idsUsuario: [idAdmin] }
}

// Limpieza por `sql()` de lo que `service_role` no puede borrar por la REST (sin grant: daría 42501). Si falla avisa y sigue.
const TABLAS_LIMPIABLES = ['procesos_masivos', 'capacidades_ejecucion', 'conexiones'] as const
async function limpiarTabla(tabla: (typeof TABLAS_LIMPIABLES)[number], orgId: string) {
  if (!TABLAS_LIMPIABLES.includes(tabla)) throw new Error(`limpiarTabla: tabla no permitida (${tabla})`)
  await sql(`delete from public."${tabla}" where organizacion_id = $1`, [orgId]).catch((e) => console.warn(`limpieza E2E: ${tabla} → ${(e as Error).message}`))
}

export async function limpiar(datos: Sembrado) {
  await borrar(`usuario_empresa_activa?user_id=in.(${datos.idsUsuario.join(',')})`)
  await limpiarTabla('procesos_masivos', datos.orgId)
  await limpiarTabla('capacidades_ejecucion', datos.orgId)
  await limpiarTabla('conexiones', datos.orgId)
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`empresas?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  for (const id of datos.idsUsuario) await borrarUsuario(id)
}

// Ingreso por el formulario. Los campos se llenan con `fill` y no se tipean con el recorrido visible: en modo visible cada
// tecla cuesta el `delay` de 90 ms más el `slowMo` de 350 ms del proyecto, y un correo y una clave de ~45 caracteres
// suman ~30 s por ingreso (`exportacion-total` ingresa tres veces); el clic en «Ingresar» sí mueve el cursor.
export async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
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
