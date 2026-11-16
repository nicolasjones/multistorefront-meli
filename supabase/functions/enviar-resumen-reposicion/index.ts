import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar, type Deps, type Generado } from './handler.ts'

// Adaptador explícito: cada RPC real se envuelve para cumplir `Deps`. La clave de servicio vive solo
// en esta función (servidor) y solo llama a las tres RPC del resumen, que son exclusivas de service_role.
Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const datos: Deps['datos'] = {
    organizaciones: async () => {
      const { data, error } = await cliente.rpc('organizaciones_con_resumen_pendiente')
      return { data: data as string[] | null, error }
    },
    generar: async (organizacion, tope) => {
      const { data, error } = await cliente.rpc('generar_resumen_reposicion', { p_organizacion: organizacion, p_tope: tope })
      return { data: data as Generado[] | null, error }
    },
    cerrar: async (resumen, enviado, mensaje) => {
      const { data, error } = await cliente.rpc('cerrar_resumen_reposicion', { p_resumen: resumen, p_enviado: enviado, p_error: mensaje })
      return { data, error }
    },
  }
  return manejar(req, {
    token: Deno.env.get('AVISOS_REPOSICION_TOKEN'),
    panelUrl: Deno.env.get('PANEL_URL'),
    datos,
    enviar: enviarPorSmtp,
  })
})
