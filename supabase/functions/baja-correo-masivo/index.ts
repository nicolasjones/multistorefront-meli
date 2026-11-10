import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Adaptador explícito: el método real se envuelve para cumplir `Deps`, de modo que un cambio del SDK que rompa el
// contrato falle al compilar y no en runtime. La service-role vive solo en esta función.
Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin: Deps['admin'] = {
    rpc: async (nombre, args) => {
      const { data, error } = await cliente.rpc(nombre, args)
      return { data, error }
    },
  }
  return manejar(req, { admin })
})
