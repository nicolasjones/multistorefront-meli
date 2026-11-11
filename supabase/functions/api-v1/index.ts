// Cableo real de la API pública v1 (F-API-01, T006). La lógica vive en
// `handler.ts` —probable con `node --test` sin Deno ni Supabase—; acá se arma
// el cliente real.
//
// La clave de servicio vive solo en el servidor: nunca viaja al navegador ni
// se devuelve en una respuesta. La organización la pone siempre la clave de
// API (el SQL de lectura la filtra dentro de la consulta).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { manejar, type Deps, type Lectura, type Limite, type Validacion } from './handler.ts'

// El contrato viaja con la función (se despliega su carpeta) y se lee una sola
// vez: `GET /v1/openapi.json` lo sirve sin clave.
const contrato = JSON.parse(await Deno.readTextFile(new URL('./openapi.json', import.meta.url)))

Deno.serve((req) => {
  const cliente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const deps: Deps = {
    openapi: async () => contrato,
    validarClave: async (token) => {
      const { data, error } = await cliente.rpc('api_validar_clave', { p_token: token })
      return { data: (data as Validacion[] | null) ?? null, error }
    },
    controlarLimite: async (claveId) => {
      const { data, error } = await cliente.rpc('api_controlar_limite', { p_clave_id: claveId })
      return { data: (data as Limite[] | null) ?? null, error }
    },
    registrarLlamada: async (llamada) => {
      const { error } = await cliente.rpc('api_registrar_llamada', {
        p_clave_id: llamada.clave_id,
        p_organizacion_id: llamada.organizacion_id,
        p_metodo: llamada.metodo,
        p_ruta: llamada.ruta,
        p_version: llamada.version,
        p_estado_http: llamada.estado_http,
        p_duracion_ms: llamada.duracion_ms,
      })
      return { data: null, error }
    },
    leer: async (recurso, organizacionId, cursor, limite, actualizadoDesde) => {
      const { data, error } = await cliente.rpc(`api_leer_${recurso}`, {
        p_organizacion_id: organizacionId,
        p_cursor: cursor,
        p_limite: limite,
        p_actualizado_desde: actualizadoDesde,
      })
      return { data: (data as Lectura[] | null) ?? null, error }
    },
  }

  return manejar(req, deps)
})
