import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { crearLimitador, enteroPositivo } from '../_shared/limite-memoria.ts'
import { manejar, type Deps } from './handler.ts'

// Mejor esfuerzo por isolate: corta un bucle de envíos; la cuota persistente por usuario y hora queda pendiente.
const limitador = crearLimitador({ max: enteroPositivo(Deno.env.get('CORREO_PROVEEDOR_LIMITE_HORA'), 20), ventanaMs: 60 * 60 * 1000 })

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
  return manejar(req, {
    getUser,
    caller,
    enviar: enviarPorSmtp,
    limitar: (usuarioId) => limitador.consumir(usuarioId),
    // Rastro mínimo en los logs de la función: sin asunto ni cuerpo, sin dirección de destino.
    registrar: (evento) => console.info('enviar-correo-proveedor: envío', JSON.stringify({ ...evento, en: new Date().toISOString() })),
  })
})
