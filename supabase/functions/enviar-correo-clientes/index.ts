import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar, type Deps } from './handler.ts'

// Adaptador explícito: cada acceso real se envuelve para cumplir `Deps`, de modo que un cambio del SDK
// que rompa el contrato falle al compilar y no en runtime. La service-role vive solo acá (servidor).
// Autorización SIN bypass: permisos y clientes se leen con el JWT del llamador (RLS del llamador);
// el service-role solo verifica el JWT. Así un cliente de otra organización nunca entra al envío.
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const anon = (jwt: string) =>
    createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const deps: Deps = {
    verificarJwt: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null }
    },
    permisos: async (jwt) => {
      const { data, error } = await anon(jwt).rpc('permisos_actuales')
      return { data: (data ?? []) as { seccion: string; nivel: string }[], error }
    },
    clientes: async (jwt, ids) => {
      const { data, error } = await anon(jwt).from('clientes').select('id,nombre,correo').in('id', ids)
      return { data: (data ?? []) as { id: string; nombre: string; correo: string | null }[], error }
    },
    enviar: enviarPorSmtp,
  }
  return manejar(req, deps)
})
