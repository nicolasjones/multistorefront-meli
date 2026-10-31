// Cliente HTTP mínimo contra Supabase (PostgREST + Auth). Sin dependencias.
// `admin` usa la service-role key SOLO para lo que no vive en `dominio` (organización, usuarios de Auth,
// membresías): el esquema `dominio` solo da permisos a `authenticated`, así que todo dato de negocio se escribe
// como un usuario real por las RPC. Nunca se envía la service-role key a un navegador.
const LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']

export function configurar(env = process.env) {
  const url = (env.SUPABASE_URL || 'http://127.0.0.1:9310').replace(/\/$/, '')
  const servicio = env.SUPABASE_SERVICE_ROLE_KEY
  const anon = env.SUPABASE_ANON_KEY
  if (!servicio || !anon) throw new Error('Faltan SUPABASE_SERVICE_ROLE_KEY y/o SUPABASE_ANON_KEY.')
  const host = new URL(url).hostname
  const permitidos = (env.DEMO_HOSTS_PERMITIDOS || '').split(',').map((h) => h.trim()).filter(Boolean)
  if (!LOCALES.includes(host) && !permitidos.includes(host)) {
    throw new Error(`${host} no es un Supabase local ni figura en DEMO_HOSTS_PERMITIDOS; se aborta para no sembrar datos de demo donde no corresponde.`)
  }
  return { url, servicio, anon, host }
}

async function pedir(cfg, ruta, { metodo = 'GET', cuerpo, token, clave, perfil, preferir } = {}) {
  const cabeceras = { apikey: clave ?? cfg.anon, authorization: `Bearer ${token ?? cfg.servicio}`, 'content-type': 'application/json' }
  if (perfil) { cabeceras['accept-profile'] = perfil; cabeceras['content-profile'] = perfil }
  if (preferir) cabeceras.prefer = preferir
  const r = await fetch(`${cfg.url}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
  const texto = await r.text()
  let datos = null
  try { datos = texto ? JSON.parse(texto) : null } catch { datos = texto }
  if (!r.ok) {
    const mensaje = typeof datos === 'object' && datos ? (datos.message || datos.msg || JSON.stringify(datos)) : String(datos)
    const e = new Error(`${metodo} ${ruta.split('?')[0]} → ${r.status}: ${mensaje}`)
    e.estado = r.status; e.codigo = datos?.code
    throw e
  }
  return datos
}

export function crearAdmin(cfg) {
  const base = { clave: cfg.servicio }
  return {
    insertar: (tabla, cuerpo) => pedir(cfg, `/rest/v1/${tabla}`, { ...base, metodo: 'POST', cuerpo, preferir: 'return=representation' }),
    leer: (ruta) => pedir(cfg, `/rest/v1/${ruta}`, base),
    borrar: (ruta) => pedir(cfg, `/rest/v1/${ruta}`, { ...base, metodo: 'DELETE' }),
    crearUsuario: (correo, password, metadatos = {}) => pedir(cfg, '/auth/v1/admin/users', { ...base, metodo: 'POST', cuerpo: { email: correo, password, email_confirm: true, user_metadata: metadatos } }),
    buscarUsuario: async (correo) => {
      const r = await pedir(cfg, '/auth/v1/admin/users?per_page=1000', base)
      return (r.users ?? []).find((u) => u.email === correo) ?? null
    },
    borrarUsuario: (id) => pedir(cfg, `/auth/v1/admin/users/${id}`, { ...base, metodo: 'DELETE' }),
  }
}

// Sesión de un usuario real: todo lo de negocio pasa por acá.
export async function iniciarSesion(cfg, correo, password) {
  const t = await pedir(cfg, '/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: correo, password }, token: cfg.anon })
  const token = t.access_token
  const ses = {
    correo, userId: t.user.id,
    rpc: (nombre, args = {}) => pedir(cfg, `/rest/v1/rpc/${nombre}`, { metodo: 'POST', cuerpo: args, token }),
    insertar: (tabla, cuerpo, perfil = 'public') => pedir(cfg, `/rest/v1/${tabla}`, { metodo: 'POST', cuerpo, token, perfil, preferir: 'return=representation' }),
    actualizar: (ruta, cuerpo, perfil = 'public') => pedir(cfg, `/rest/v1/${ruta}`, { metodo: 'PATCH', cuerpo, token, perfil, preferir: 'return=representation' }),
    leer: (ruta, perfil = 'public') => pedir(cfg, `/rest/v1/${ruta}`, { token, perfil }),
  }
  return ses
}
