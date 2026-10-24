import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

// Las tiendas viven en https; solo el desarrollo local (SUPABASE_URL en localhost / 127.0.0.1) usa http.
const local = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|kong)(:|\/|$)/.test(Deno.env.get('SUPABASE_URL') ?? '')

// Adaptador explícito: cada método real se envuelve para cumplir `Deps`, de modo que un cambio del SDK que rompa
// el contrato falle al compilar y no en runtime. La service-role vive solo en esta función.
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const cliente = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin: Deps['admin'] = {
    rpc: async (nombre, args) => {
      const { data, error } = await cliente.rpc(nombre, args)
      return { data, error }
    },
  }
  // El correo de recuperación (plantilla de Auth del template) lo envía un cliente con la clave pública.
  const enviarClave: Deps['enviarClave'] = async (email, redirectTo) => {
    const publico = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await publico.auth.resetPasswordForEmail(email, { redirectTo })
    return { data, error }
  }
  // `EdgeRuntime.waitUntil` deja terminar la consulta y el envío después de responder (respuesta de tiempo parejo).
  const enSegundoPlano: Deps['enSegundoPlano'] = (tarea) => {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
    if (runtime) runtime.waitUntil(tarea)
  }
  return manejar(req, { protocolo: local ? 'http' : 'https', admin, enviarClave, enSegundoPlano })
})
