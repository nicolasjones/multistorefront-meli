import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Calculo, type Deps } from './handler.ts'

// Adaptador explícito: cada llamada real se envuelve para cumplir `Deps`. La clave de servicio vive solo en
// esta función (servidor): lista las organizaciones y llama a `recalcular_alertas_inicio`, exclusiva de service_role.
Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const datos: Deps['datos'] = {
    organizaciones: async () => {
      const { data, error } = await cliente.from('organizaciones').select('id').order('id')
      return { data: (data as { id: string }[] | null)?.map((fila) => fila.id) ?? null, error }
    },
    recalcular: async (organizacion) => {
      const { data, error } = await cliente.rpc('recalcular_alertas_inicio', { p_organizacion: organizacion })
      return { data: data as Calculo | null, error }
    },
  }
  return manejar(req, { token: Deno.env.get('ALERTAS_INICIO_TOKEN'), datos })
})
