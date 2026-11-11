// Cableo real de la entrega de avisos (F-API-01, T008). La lógica vive en
// `handler.ts` —probable con `node --test` sin Deno ni Supabase—; acá se arma
// el cliente real.
//
// La función es interna: la llama el flow de Kestra con la clave de servicio
// de Supabase (nunca una clave de cliente). El secreto de firma de cada
// suscripción lo lee la base (Vault) y nunca sale hacia el navegador.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps, type EstadoEntrega } from './handler.ts'

Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const deps: Deps = {
    token: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    entrega: async (entregaId) => {
      const { data, error } = await cliente.rpc('api_entrega_para_entregar', { p_entrega_id: entregaId })
      return { data: data as { url: string; evento: unknown; secreto: string }[] | null, error }
    },
    resolver: async (entregaId: string, estado: EstadoEntrega, estadoHttp: number | null, error: string | null) => {
      const { error: errorResolucion } = await cliente.rpc('api_resolver_entrega', {
        p_entrega_id: entregaId,
        p_estado: estado,
        p_estado_http: estadoHttp,
        p_error: error,
        p_espera_seg: null,
      })
      return { data: null, error: errorResolucion }
    },
    resolverDns: async (host) => {
      const direcciones: string[] = []
      for (const tipo of ['A', 'AAAA'] as const) {
        try {
          direcciones.push(...(await Deno.resolveDns(host, tipo)))
        } catch {
          // El host puede no tener registros de ese tipo: se sigue con el otro.
        }
      }
      return direcciones
    },
    fetch,
    ahora: () => Date.now(),
  }

  return manejar(req, deps)
})
