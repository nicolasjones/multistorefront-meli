import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Puerto por defecto alineado a WEB_PORT (spec 015, contracts/variables-puerto.md)
// — igual que SUPERSET_PUBLIC_URL en este mismo .env.example, se actualiza a
// mano acá si se cambia WEB_PORT (esta función no puede leer variables de
// entorno del Refine que la invoca, solo las propias del contenedor de Edge
// Functions).
const appUrl = (Deno.env.get('APP_URL') ?? 'http://127.0.0.1:3100').replace(/\/$/, '')

// Adaptador explícito: cada método real se envuelve para cumplir `Deps`, de modo que un cambio del
// SDK que rompa el contrato falle al compilar y no en runtime.
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const cliente = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin: Deps['admin'] = {
    auth: {
      getUser: async (jwt) => {
        const { data, error } = await cliente.auth.getUser(jwt)
        return { data, error }
      },
      admin: {
        listUsers: async (params) => {
          const { data, error } = await cliente.auth.admin.listUsers(params)
          return { data, error }
        },
        deleteUser: async (id) => {
          const { data, error } = await cliente.auth.admin.deleteUser(id)
          return { data, error }
        },
        inviteUserByEmail: async (email, options) => {
          const { data, error } = await cliente.auth.admin.inviteUserByEmail(email, options)
          return { data, error }
        },
      },
    },
    from: (tabla) => cliente.from(tabla),
  }
  const caller: Deps['caller'] = (jwt) => {
    const clienteLlamador = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    return {
      rpc: async (nombre, args) => {
        const { data, error } = await clienteLlamador.rpc(nombre, args)
        return { data, error }
      },
    }
  }
  return manejar(req, { appUrl, admin, caller })
})
