// Contrato: specs/003-fundacion-multitenant/contracts/crear-organizacion.md
// La lógica vive en handler.ts (probada con `pnpm test:edge:crear-organizacion`); acá solo se
// cablea el cliente real con la service-role key.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

Deno.serve((req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  return manejar(req, { admin: admin as unknown as Deps['admin'] })
})
