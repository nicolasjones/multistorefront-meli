// Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md
//
// La lógica vive en handler.ts (probada con `pnpm test:edge:emitir-acceso-reporte`); acá solo se
// cablean los clientes reales. La autorización NO se reescribe: se arma un cliente autenticado como
// el propio usuario (nunca la service-role para datos de negocio) y la RPC
// `resolver_organizacion_reporte` decide — incluida la sección de permisos del reporte, si la declara.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps } from './handler.ts'

Deno.serve((req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Solo para validar el JWT (mismo patrón que crear-organizacion).
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const comoUsuario = (jwt: string) =>
    createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } })

  // SUPERSET_URL es server-to-server (en local, un nombre de contenedor Docker); SUPERSET_PUBLIC_URL
  // es la que termina en el navegador (el navegador no resuelve el nombre del contenedor).
  const deps: Deps = {
    validarJwt: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return !error && !!data?.user
    },
    resolverOrganizacion: async (jwt, reporteId) => {
      const { data } = await comoUsuario(jwt).rpc('resolver_organizacion_reporte', {
        p_reporte_id: reporteId,
      })
      return (data as string | null) ?? null
    },
    dashboardUuid: async (jwt, reporteId) => {
      const { data } = await comoUsuario(jwt)
        .from('reportes')
        .select('superset_dashboard_uuid')
        .eq('id', reporteId)
        .maybeSingle()
      return (data?.superset_dashboard_uuid as string | undefined) ?? null
    },
    config: {
      supersetUrl: Deno.env.get('SUPERSET_URL')!,
      supersetPublicUrl: Deno.env.get('SUPERSET_PUBLIC_URL')!,
      username: Deno.env.get('SUPERSET_GUEST_TOKEN_USERNAME')!,
      password: Deno.env.get('SUPERSET_GUEST_TOKEN_PASSWORD')!,
    },
    fetch,
  }
  return manejar(req, deps)
})
