// Contrato: ver spec del mecanismo de búsqueda documental genérica en este template (sección "Contrato de búsqueda").
//
// La lógica vive en handler.ts (probada con `pnpm test:edge:preguntar-documentos`); acá solo se cablean los clientes
// reales. Nunca service-role para datos de negocio: lo del usuario va con la clave anon y su JWT (RLS decide) y la
// service-role queda en el cliente admin (validar el JWT y resolver política/credencial).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { prepararInvocacion } from '../_shared/ia/index.ts'
import { generarEmbedding } from '../_shared/embeddings.ts'
import { fetchConTimeout } from '../_shared/fetch-ia.ts'
import { crearLimitador, enteroPositivo } from '../_shared/limite-memoria.ts'
import { manejar, type Deps } from './handler.ts'

// Mejor esfuerzo por isolate (ver _shared/limite-memoria.ts); la cuota persistente por usuario queda como pendiente.
const limitador = crearLimitador({ max: enteroPositivo(Deno.env.get('PREGUNTAR_DOCUMENTOS_LIMITE_HORA'), 30), ventanaMs: 60 * 60 * 1000 })

Deno.serve((req) => {
  const deps: Deps = {
    crearAdmin: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    crearCliente: (jwt) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }),
    prepararInvocacion,
    generarEmbedding,
    fetchProveedor: (limiteSegundos) => fetchConTimeout(limiteSegundos),
    limitador,
    ahora: () => Date.now(),
  }
  return manejar(req, deps)
})
