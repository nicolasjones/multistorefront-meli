import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar, type Deps } from './handler.ts'

// Adaptador explícito: cada acceso real se envuelve para cumplir `Deps`, de modo que un cambio del SDK
// que rompa el contrato falle al compilar y no en runtime. La service-role vive solo acá (servidor).
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
  const deps: Deps = {
    verificarJwt: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null }
    },
    caller: (jwt) => {
      const cliente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      return { rpc: async (nombre, args) => {
        const { data, error } = await cliente.rpc(nombre, args)
        return { data, error }
      } }
    },
    datos: {
      reclamarEnvio: async (id) => {
        const { data, error } = await admin.from('solicitudes_acceso')
          .update({ correo_enviado_en: new Date().toISOString() }).eq('id', id).is('correo_enviado_en', null).select('id')
        if (error) throw new Error(error.message)
        return (data ?? []).length > 0
      },
      liberarEnvio: async (id) => {
        const { error } = await admin.from('solicitudes_acceso').update({ correo_enviado_en: null }).eq('id', id)
        if (error) throw new Error(error.message)
      },
      administradoresActivos: async (organizacionId) => {
        const { data, error } = await admin.from('usuarios_organizacion')
          .select('user_id').eq('organizacion_id', organizacionId).eq('rol_id', 'administrador').eq('estado', 'activo')
        if (error) throw new Error(error.message)
        const correos = await Promise.all((data ?? []).map(async ({ user_id }: { user_id: string }) => {
          const { data: cuenta } = await admin.auth.admin.getUserById(user_id)
          return cuenta.user?.email ?? null
        }))
        return correos.filter((correo): correo is string => Boolean(correo))
      },
      nombreVisible: async (userId) => {
        const { data } = await admin.from('perfiles_usuario').select('nombre, apellido').eq('user_id', userId).maybeSingle()
        const nombre = [data?.nombre, data?.apellido].filter(Boolean).join(' ').trim()
        return nombre || null
      },
    },
    enviar: enviarPorSmtp,
  }
  return manejar(req, deps)
})
