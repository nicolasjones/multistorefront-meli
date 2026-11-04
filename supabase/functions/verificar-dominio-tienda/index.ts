import { createClient } from 'npm:@supabase/supabase-js@2'
import { clasificarFalloTls, manejar, type Certificado, type Deps } from './handler.ts'

// Adaptador explícito: cada acceso real se envuelve para cumplir `Deps`. La service-role vive solo acá
// (servidor) y solo ejecuta `registrar_verificacion_dns`.
const TIEMPO_TLS_MS = 5000

async function comprobarTls(host: string): Promise<Certificado> {
  const temporizador = AbortSignal.timeout(TIEMPO_TLS_MS)
  try {
    const conexion = await Promise.race([
      Deno.connectTls({ hostname: host, port: 443 }),
      new Promise<never>((_, rechazar) => temporizador.addEventListener('abort', () => rechazar(new Error('timeout')))),
    ])
    conexion.close()
    return 'activo'
  } catch (e) {
    return clasificarFalloTls(e instanceof Error ? `${e.name} ${e.message}` : String(e))
  }
}

// Sin registros (NXDOMAIN / sin datos) → []; cualquier otro fallo propaga y la función responde 502.
async function resolver(host: string, tipo: 'A' | 'CNAME' | 'TXT'): Promise<string[]> {
  try {
    const respuesta = await Deno.resolveDns(host, tipo)
    return (respuesta as (string | string[])[]).map((valor) => (Array.isArray(valor) ? valor.join('') : valor))
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return []
    throw e
  }
}

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const deps: Deps = {
    verificarJwt: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data.user ? null : { id: data.user.id }
    },
    caller: (jwt) => {
      const cliente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      return { rpc: async (nombre, args) => {
        const { data, error } = await cliente.rpc(nombre, args)
        return { data, error }
      } }
    },
    admin: {
      registrar: async (empresaId, resultados, certificado) => {
        const { error } = await admin.rpc('registrar_verificacion_dns', {
          p_empresa_id: empresaId,
          p_resultados: resultados,
          p_certificado: certificado,
        })
        return { error }
      },
    },
    dns: {
      resolverA: (host) => resolver(host, 'A'),
      resolverCname: (host) => resolver(host, 'CNAME'),
      resolverTxt: (host) => resolver(host, 'TXT'),
    },
    tls: { comprobar: comprobarTls },
  }
  return manejar(req, deps)
})
