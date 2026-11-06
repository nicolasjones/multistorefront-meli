import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// [MSF-779:T024] Cierre de la épica MSF-133 (SC-003): con dos empresas de organizaciones distintas,
// alta de dominio, verificación (DNS simulado), preparar cambios en borrador, publicar, restaurar una
// versión y publicar de nuevo; los cambios de una empresa no tocan la otra ni lo que ve `anon`.
// Va por la API (RPC con la sesión de cada administrador) porque la verificación real consulta DNS:
// el resultado de la Edge Function se simula llamando `registrar_verificacion_dns` con la service-role
// key, que vive solo en Node y nunca llega al navegador. Requiere el stack local (`pnpm dev:supabase`).
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY el archivo se omite (no entra al CI
// público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de tienda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const admin = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function restAdmin<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: admin({ prefer: 'return=representation', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function borrarAdmin(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: admin({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function bajaUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

async function token(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`ingreso de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

// RPC con la sesión de una persona (`jwt`), con el JWT de service_role (`'service'`) o como anónimo (`null`).
async function rpc(nombre: string, args: Record<string, unknown>, jwt: string | null | 'service', esquema = 'public') {
  const autorizacion = jwt === 'service' ? serviceKey : (jwt ?? anonKey)
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: jwt === 'service' ? (serviceKey ?? '') : (anonKey ?? ''),
      authorization: `Bearer ${autorizacion}`,
      'content-type': 'application/json',
      'content-profile': esquema,
    },
    body: JSON.stringify(args),
  })
  const texto = await r.text()
  return { ok: r.ok, status: r.status, cuerpo: texto ? (JSON.parse(texto) as unknown) : null }
}

const REGISTROS_OK = (dominio: string) => [
  { tipo: 'A', nombre: dominio, estado: 'correcto', valor_encontrado: '203.0.113.10' },
  { tipo: 'TXT', nombre: `_verificacion.${dominio}`, estado: 'correcto', valor_encontrado: 'token' },
]

test.describe('Tienda online · dominio, borrador y versiones con dos empresas (SC-003)', () => {
  test.skip(
    !url || !serviceKey || !anonKey,
    'Requiere el stack local de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY).',
  )

  test('[MSF-779:T024] alta de dominio, verificación, borrador, publicar, restaurar y publicar sin tocar la otra empresa', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const orgs: string[] = []
    const usuarios: string[] = []
    try {
      const tiendas: Array<{ org: string; empresa: string; jwt: string; dominio: string; bienvenida: string }> = []
      for (const letra of ['a', 'b']) {
        const [org] = await restAdmin<{ id: string }>('organizaciones', { nombre: `E2E tienda ${letra} ${sufijo}` })
        orgs.push(org.id)
        const [empresa] = await restAdmin<{ id: string }>(
          'empresas',
          { organizacion_id: org.id, nombre: `Empresa ${letra} ${sufijo}` },
          'dominio',
        )
        const correo = `admin-tienda-${letra}-${sufijo}@example.com`
        const idUsuario = await altaUsuario(correo)
        usuarios.push(idUsuario)
        await restAdmin('usuarios_organizacion', { user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' })
        tiendas.push({
          org: org.id,
          empresa: empresa.id,
          jwt: await token(correo),
          dominio: `tienda-${letra}-${sufijo}.ejemplo.com`,
          bienvenida: `Bienvenida ${letra.toUpperCase()} ${sufijo}`,
        })
      }
      const [a, b] = tiendas

      // 1) Alta del dominio de cada empresa: queda pendiente hasta verificarlo.
      for (const t of tiendas) {
        const alta = await rpc('configurar_dominio_tienda', { p_empresa_id: t.empresa, p_dominio: t.dominio }, t.jwt)
        expect(alta.ok, JSON.stringify(alta.cuerpo)).toBe(true)
      }
      // El administrador de A no configura el dominio de B.
      const cruzado = await rpc('configurar_dominio_tienda', { p_empresa_id: b.empresa, p_dominio: `x-${a.dominio}` }, a.jwt)
      expect(cruzado.ok).toBe(false)

      // 2) Verificación (DNS simulado): `registrar_verificacion_dns` solo la ejecuta service_role.
      for (const t of tiendas) {
        expect((await rpc('preparar_verificacion_tienda', { p_empresa_id: t.empresa }, t.jwt)).ok).toBe(true)
        const denegado = await rpc(
          'registrar_verificacion_dns',
          { p_empresa_id: t.empresa, p_dominio: t.dominio, p_redireccion: null, p_resultados: [], p_certificado: 'pendiente' },
          t.jwt,
        )
        expect(denegado.ok).toBe(false)
        const registro = await rpc(
          'registrar_verificacion_dns',
          {
            p_empresa_id: t.empresa,
            p_dominio: t.dominio,
            p_redireccion: null,
            p_resultados: REGISTROS_OK(t.dominio),
            p_certificado: 'activo',
          },
          'service',
        )
        expect(registro.ok, JSON.stringify(registro.cuerpo)).toBe(true)
      }
      const resuelta = await rpc('tienda_por_dominio', { host: a.dominio }, null, 'publico')
      expect(resuelta.ok).toBe(true)
      expect(JSON.stringify(resuelta.cuerpo)).toContain(`Empresa a ${sufijo}`)

      // 3) Preparar cambios en borrador: no cambia lo que ve `anon` ni la otra empresa.
      const guardar = await rpc(
        'guardar_borrador_tienda',
        { p_empresa: a.empresa, p_area: 'contenido', p_datos: { bienvenida: a.bienvenida } },
        a.jwt,
      )
      expect(guardar.ok, JSON.stringify(guardar.cuerpo)).toBe(true)
      const anonAntes = await rpc('contenido_por_dominio', { host: a.dominio }, null, 'publico')
      expect(JSON.stringify(anonAntes.cuerpo)).not.toContain(a.bienvenida)
      const borradorAnon = await rpc('obtener_borrador_tienda', { p_empresa: a.empresa }, null)
      expect(borradorAnon.ok).toBe(false)
      const borradorCruzado = await rpc('obtener_borrador_tienda', { p_empresa: a.empresa }, b.jwt)
      expect(borradorCruzado.ok).toBe(false)

      // 4) Publicar: lo ve `anon` en A, y B no cambia.
      const publicar = await rpc('publicar_tienda', { p_empresa: a.empresa }, a.jwt)
      expect(publicar.ok, JSON.stringify(publicar.cuerpo)).toBe(true)
      const anonDespues = await rpc('contenido_por_dominio', { host: a.dominio }, null, 'publico')
      expect(JSON.stringify(anonDespues.cuerpo)).toContain(a.bienvenida)
      const anonB = await rpc('contenido_por_dominio', { host: b.dominio }, null, 'publico')
      expect(JSON.stringify(anonB.cuerpo)).not.toContain(a.bienvenida)

      // 5) Restaurar la versión 1 (como borrador) y publicar de nuevo: crea una versión nueva.
      const versiones = (await rpc('listar_versiones_tienda', { p_empresa: a.empresa }, a.jwt)).cuerpo as Array<{
        numero: number
        vigente: boolean
      }>
      expect(versiones[0]).toMatchObject({ numero: 2, vigente: true })
      const restaurar = await rpc('restaurar_version_tienda', { p_empresa: a.empresa, p_numero: 1 }, a.jwt)
      expect(restaurar.ok, JSON.stringify(restaurar.cuerpo)).toBe(true)
      // Restaurar no publica: `anon` sigue viendo lo vigente.
      const anonRestaurada = await rpc('contenido_por_dominio', { host: a.dominio }, null, 'publico')
      expect(JSON.stringify(anonRestaurada.cuerpo)).toContain(a.bienvenida)
      expect((await rpc('publicar_tienda', { p_empresa: a.empresa }, a.jwt)).ok).toBe(true)
      const anonFinal = await rpc('contenido_por_dominio', { host: a.dominio }, null, 'publico')
      expect(JSON.stringify(anonFinal.cuerpo)).not.toContain(a.bienvenida)
      const finales = (await rpc('listar_versiones_tienda', { p_empresa: a.empresa }, a.jwt)).cuerpo as Array<{ numero: number }>
      expect(finales[0].numero).toBe(3)
      // B no tiene versiones de A.
      const deB = (await rpc('listar_versiones_tienda', { p_empresa: b.empresa }, b.jwt)).cuerpo as Array<{ numero: number }>
      expect(deB.map((v) => v.numero)).not.toContain(3)
    } finally {
      // Las organizaciones caen en cascada con sus empresas, tiendas, borradores y versiones.
      for (const org of orgs) await borrarAdmin(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await bajaUsuario(id)
    }
  })
})
