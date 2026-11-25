// Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md
//
// La lógica vive en handler.ts (probada con `pnpm test:edge:iniciar-sesion-oauth`); acá solo se
// cablean los clientes reales. La autorización NO se reescribe: se arma un cliente autenticado como
// el propio usuario (nunca la service-role para datos de negocio) y RLS de `conexiones_oauth` decide.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

Deno.serve((req) => {
  const deps: Deps = {
    // Solo para validar el JWT (service-role).
    validarJwt: async (jwt) => {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await admin.auth.getUser(jwt)
      return !error && !!data?.user
    },
    leerConexion: async (jwt, conexionId) => {
      const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      })
      const { data } = await asUser
        .from('conexiones_oauth')
        .select('organizacion_id, nango_connection_id, integraciones_oauth(clave)')
        .eq('id', conexionId)
        .maybeSingle()
      return data
    },
    config: () => ({
      nangoUrl: Deno.env.get('NANGO_URL')!,
      nangoSecretKey: Deno.env.get('NANGO_SECRET_KEY')!,
    }),
    fetch,
  }
  return manejar(req, deps)
})
