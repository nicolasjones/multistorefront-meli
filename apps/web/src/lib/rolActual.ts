import { ETIQUETA_ROL } from './permisos'
import { supabaseClient } from './supabase'

// Texto genérico cuando no se puede resolver el rol: el rol solo ilustra el mensaje de
// «Acceso restringido» y nunca debe dejar la pantalla en blanco ni mostrar un literal técnico.
export const ROL_GENERICO = 'actual'

// Rol (identificador) de la persona en la organización indicada, bajo RLS. Devuelve '' si no
// hay sesión u organización, si la consulta falla o si no hay membresía.
export async function resolverRolId(organizacionId: string | null): Promise<string> {
  const { data: sesion } = await supabaseClient.auth.getUser()
  const userId = sesion.user?.id
  if (!userId || !organizacionId) return ''
  const { data, error } = await supabaseClient
    .from('usuarios_organizacion')
    .select('rol_id')
    .eq('user_id', userId)
    .eq('organizacion_id', organizacionId)
    .maybeSingle()
  return error ? '' : (data?.rol_id ?? '')
}

// Nombre visible del rol (p. ej. «Operador»); el genérico si el identificador es desconocido.
export function etiquetaDeRol(rolId: string): string {
  return ETIQUETA_ROL[rolId] ?? ROL_GENERICO
}
