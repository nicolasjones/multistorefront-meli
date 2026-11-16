import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Adaptador explícito: el método real se envuelve para cumplir `Deps`. Usa la clave anónima: solo lee funciones
// de `publico` ejecutables por anon (nunca la service-role).
Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const deps: Deps = {
    rpc: async (nombre, args) => {
      const { data, error } = await cliente.schema('publico').rpc(nombre, args)
      return { data, error }
    },
  }
  return manejar(req, deps)
})
