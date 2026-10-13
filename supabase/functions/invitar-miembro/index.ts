import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Puerto por defecto alineado a WEB_PORT (spec 015, contracts/variables-puerto.md)
// — igual que SUPERSET_PUBLIC_URL en este mismo .env.example, se actualiza a
// mano acá si se cambia WEB_PORT (esta función no puede leer variables de
// entorno del Refine que la invoca, solo las propias del contenedor de Edge
// Functions).
const appUrl = (Deno.env.get('APP_URL') ?? 'http://127.0.0.1:3100').replace(/\/$/, '')

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const caller = (jwt: string) => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  return manejar(req, { appUrl, admin, caller } as unknown as Deps)
})
