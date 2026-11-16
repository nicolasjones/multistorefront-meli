import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, SALTOS_PROXY_CONFIABLES, type Deps } from './handler.ts'

// Adaptador explícito (como `solicitar-acceso`). La service-role vive solo acá (servidor). La función se
// sirve SIN sesión: `verify_jwt = false` declarado en `supabase/config.toml` (el gateway no exige un JWT — la
// página manda la clave pública, que no es un JWT) y solo llama a funciones ejecutables por service_role.
// `SEGUIMIENTO_SALTOS_PROXY` ajusta, por entorno, cuántos proxies de confianza agregan su IP al final de
// `x-forwarded-for` (1 en STG/PROD: Traefik → Kong). Ver `docs/service-seguimiento.md`.
const saltosProxy = (() => {
  const bruto = (Deno.env.get('SEGUIMIENTO_SALTOS_PROXY') ?? '').trim()
  if (!bruto) return SALTOS_PROXY_CONFIABLES
  const valor = Number(bruto)
  return Number.isInteger(valor) && valor >= 0 ? valor : SALTOS_PROXY_CONFIABLES
})()

Deno.serve((req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const deps: Deps = {
    sal: Deno.env.get('SEGUIMIENTO_IP_SALT'),
    saltosProxy,
    datos: {
      registrarConsulta: async (ipHash, ventanaSeg, limite) => {
        const { data, error } = await admin.rpc('registrar_consulta_publica', { p_ip_hash: ipHash, p_ventana_seg: ventanaSeg, p_limite: limite })
        return { data, error }
      },
      estadoPublico: async (token) => {
        const { data, error } = await admin.rpc('obtener_estado_publico_reparacion', { p_token: token })
        return { data, error }
      },
    },
  }
  return manejar(req, deps)
})
