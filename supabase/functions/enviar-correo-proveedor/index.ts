import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar, type Deps } from './handler.ts'

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
      nivelProveedores: async () => {
        const { data, error } = await cliente.rpc('permisos_actuales')
        const fila = ((data ?? []) as { seccion: string; nivel: string }[]).find((permiso) => permiso.seccion === 'proveedores')
        return { data: fila?.nivel ?? null, error }
      },
      proveedor: async (id) => {
        const { data, error } = await cliente.schema('dominio').from('proveedores').select('razon_social, correo, activo').eq('id', id).maybeSingle()
        return { data, error }
      },
    }
  }
  return manejar(req, { getUser, caller, enviar: enviarPorSmtp })
})
