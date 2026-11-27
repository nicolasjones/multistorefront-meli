import { createClient } from 'npm:@supabase/supabase-js@2'
import { crearArmadorDeDeps } from './cableado.ts'
import { manejar } from './handler.ts'

// Todo el cableado (cliente de servicio, saltos de proxy y cupo) está en `cableado.ts`, probado con `node --test`. El cliente se crea UNA vez por instancia
// y se reutiliza entre pedidos. La service-role vive solo en esta función.
const armarDeps = crearArmadorDeDeps({
  env: (clave) => Deno.env.get(clave),
  crearCliente: (url, claveDeServicio) => createClient(url, claveDeServicio, { auth: { autoRefreshToken: false, persistSession: false } }),
})

Deno.serve((req) => manejar(req, armarDeps()))
