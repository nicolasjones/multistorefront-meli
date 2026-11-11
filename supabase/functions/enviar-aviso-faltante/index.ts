import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar, type Deps, type Tomado } from './handler.ts'

// Adaptador explícito: cada RPC real se envuelve para cumplir `Deps`. La clave de servicio vive solo
// en esta función (servidor) y solo llama a las tres RPC del aviso, que son exclusivas de service_role.
Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const datos: Deps['datos'] = {
    pendientes: async (tope, limite) => {
      const { data, error } = await cliente.rpc('faltantes_avisos_pendientes', { p_tope: tope, p_limite: limite })
      return { data: data as string[] | null, error }
    },
    tomar: async (clienteId, tope) => {
      const { data, error } = await cliente.rpc('tomar_aviso_faltante', { p_cliente: clienteId, p_tope: tope })
      return { data: data as Tomado[] | null, error }
    },
    cerrar: async (clienteId, enviado, mensaje, tope) => {
      const { data, error } = await cliente.rpc('cerrar_aviso_faltante', {
        p_cliente: clienteId, p_enviado: enviado, p_error: mensaje, p_tope: tope,
      })
      return { data, error }
    },
  }
  return manejar(req, {
    token: Deno.env.get('AVISOS_FALTANTES_TOKEN'),
    datos,
    enviar: enviarPorSmtp,
  })
})
