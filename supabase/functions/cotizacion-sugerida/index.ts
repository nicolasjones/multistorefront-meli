import { createClient } from 'npm:@supabase/supabase-js@2'
import { FUENTE_URL, manejar, TIEMPO_MAXIMO_MS, type Deps } from './handler.ts'

// Adaptador explícito: cada método real se envuelve para cumplir `Deps`. Solo se usa la clave anónima
// con el JWT de quien llama (RLS manda); no hay service-role.
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const getUser: Deps['getUser'] = async (jwt) => {
    const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(jwt)
    return { data, error }
  }
  const caller: Deps['caller'] = (jwt) => {
    const cliente = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })
    return {
      nivelCotizacion: async () => {
        const { data, error } = await cliente.rpc('permisos_actuales')
        const fila = ((data ?? []) as { seccion: string; nivel: string }[]).find((permiso) => permiso.seccion === 'cotizacion_dolar')
        return { data: fila?.nivel ?? null, error }
      },
    }
  }
  const leerFuente: Deps['leerFuente'] = async () => {
    const respuesta = await fetch(FUENTE_URL, { signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS), redirect: 'error', headers: { Accept: 'application/json' } })
    if (!respuesta.ok) throw new Error(`la fuente respondió ${respuesta.status}`)
    return await respuesta.json()
  }
  return manejar(req, { getUser, caller, leerFuente })
})
