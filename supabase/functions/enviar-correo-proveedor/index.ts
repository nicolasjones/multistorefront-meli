import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { FUNCIONALIDAD_CORREO_PROVEEDOR, limiteDeCupo, rechazoPorCupo } from '../_shared/cupo-ia.ts'
import { registrarErrorDeBase } from '../_shared/log-seguro.ts'
import { manejar, type Deps } from './handler.ts'

// Tope por usuario y hora (20 por defecto, 1..1000 por `CORREO_PROVEEDOR_LIMITE_HORA`). Es PERSISTENTE: lo cuenta
// `public.consumir_cupo_ia` (lote 90) con la funcionalidad `correo-proveedor`, no el isolate.
const LIMITE_POR_DEFECTO = 20

// Adaptador explícito: cada método real se envuelve para cumplir `Deps`. Los datos del proveedor se leen con la clave anónima y
// el JWT de quien llama (RLS manda). El cliente admin (service-role) solo llama a dos RPC propias: el cupo y el registro.
Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
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
    // Falla cerrado: sin la clave de servicio o con la RPC caída, la respuesta es 503 y no se envía nada.
    consumirCupo: async (usuarioId) => {
      let cliente: ReturnType<typeof admin>
      try {
        cliente = admin()
      } catch {
        console.error('enviar-correo-proveedor: no se pudo crear el cliente del cupo')
        return { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
      }
      return await rechazoPorCupo(cliente, usuarioId, FUNCIONALIDAD_CORREO_PROVEEDOR, limiteDeCupo(Deno.env.get('CORREO_PROVEEDOR_LIMITE_HORA'), LIMITE_POR_DEFECTO), {
        agotado: 'Enviaste demasiados correos en poco tiempo. Probá de nuevo más tarde.',
      })
    },
    registrar: async ({ usuarioId, proveedorId, resultado }) => {
      const { error } = await admin().rpc('registrar_envio_correo_proveedor', { p_usuario: usuarioId, p_proveedor: proveedorId, p_resultado: resultado })
      if (error) registrarErrorDeBase('enviar-correo-proveedor: no se pudo registrar el envío', error)
    },
  })
})
