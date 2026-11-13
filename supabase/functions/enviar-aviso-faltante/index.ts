import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar } from './handler.ts'
import { armarDeps } from './servidor.ts'

Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return manejar(req, armarDeps({ cliente, token: Deno.env.get('AVISOS_FALTANTES_TOKEN'), enviar: enviarPorSmtp }))
})
