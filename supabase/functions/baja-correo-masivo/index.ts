import { createClient } from 'npm:@supabase/supabase-js@2'
import { armarDepsDesdeEntorno } from './cableado.ts'
import { manejar } from './handler.ts'

// Todo el cableado (cliente de servicio, saltos de proxy y cupo) está en `cableado.ts`, probado con `node --test`. La service-role vive solo en esta función.
Deno.serve((req) => manejar(req, armarDepsDesdeEntorno({
  env: (clave) => Deno.env.get(clave),
  crearCliente: (url, claveDeServicio) => createClient(url, claveDeServicio, { auth: { autoRefreshToken: false, persistSession: false } }),
})))
