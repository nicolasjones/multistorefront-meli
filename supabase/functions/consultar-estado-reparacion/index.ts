import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Adaptador explícito (como `solicitar-acceso`). La service-role vive solo acá (servidor); la función se sirve
// sin sesión (`verify_jwt = false` en supabase/config.toml) y solo llama a funciones ejecutables por service_role.
Deno.serve((req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const deps: Deps = {
    sal: Deno.env.get('SEGUIMIENTO_IP_SALT'),
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
