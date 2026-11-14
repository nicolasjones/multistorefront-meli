import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Certificado, type Deps } from './handler.ts'
import { comprobarTls as comprobarTlsConCierre } from './tls.ts'

// Adaptador explícito: cada acceso real se envuelve para cumplir `Deps`. La service-role vive solo acá
// (servidor) y solo ejecuta `registrar_verificacion_dns`.

// La conexión a la IP de la plataforma y el cierre de todo `Conn` (también el que vence por timeout) viven en
// `tls.ts`, que se prueba sin Deno; acá solo se cablean `Deno.connect` y `Deno.startTls`.
const comprobarTls = (host: string, ipPlataforma: string): Promise<Certificado> =>
  comprobarTlsConCierre(host, ipPlataforma, {
    // La señal cancela la conexión si sigue pendiente cuando vencen los 5 s: el socket no queda colgado.
    conectar: (ip, senal) => Deno.connect({ hostname: ip, port: 443, signal: senal }),
    iniciarTls: (tcp, nombre) => Deno.startTls(tcp as Deno.Conn, { hostname: nombre }),
  })

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
      registrar: async (empresaId, dominio, redireccion, resultados, certificado) => {
        const { error } = await admin.rpc('registrar_verificacion_dns', {
          p_empresa_id: empresaId,
          p_dominio: dominio,
          p_redireccion: redireccion,
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
