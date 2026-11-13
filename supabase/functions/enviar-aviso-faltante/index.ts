import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { crearDatos } from './datos.ts'
import { manejar } from './handler.ts'

Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { datos, sonda } = crearDatos(cliente)
  return manejar(req, {
    token: Deno.env.get('AVISOS_FALTANTES_TOKEN'),
    datos,
    sonda,
    enviar: enviarPorSmtp,
  })
})
