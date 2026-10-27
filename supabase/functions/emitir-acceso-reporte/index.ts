// Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md (+ filtro por empresa:
// specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md)
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
    empresasAccesibles: async (jwt) => {
      // `public.empresas_para_selector()` expone las empresas accesibles del usuario (las mismas
      // del selector de la barra superior). Se ejecuta COMO el usuario: la RPC es `security
      // definer` y resuelve con su sesión, no con la de la función.
      const { data, error } = await comoUsuario(jwt).rpc('empresas_para_selector')
      if (error) {
        throw new Error(`No se pudieron resolver las empresas accesibles: ${error.message}`)
      }
      const filas = (data ?? []) as { id?: string }[]
      return filas.map((fila) => fila.id).filter((id): id is string => typeof id === 'string')
    },
    reporte: async (jwt, reporteId) => {
      const { data, error } = await comoUsuario(jwt)
        .from('reportes')
        .select('superset_dashboard_uuid, filtro_empresa')
        .eq('id', reporteId)
        .maybeSingle()
      if (error) {
        // El error se propaga a propósito: si la columna `filtro_empresa` todavía no existe (la
        // migración 20270104090050 sin aplicar en ese entorno) NO es «sin acceso» sino un fallo del
        // servicio. El handler responde 503 `analitica_no_disponible` en vez de un 403 que haría
        // creer que el usuario no tiene permiso y escondería el problema.
        throw new Error(`No se pudo leer el reporte: ${error.message}`)
      }
      if (!data?.superset_dashboard_uuid) return null
      return {
        dashboardUuid: data.superset_dashboard_uuid as string,
        // `filtro_empresa` (F-VTA-22): el tablero declara si su cláusula `rls` acota por empresa.
        filtroEmpresa: data.filtro_empresa === true,
      }
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
