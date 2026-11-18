import { supabaseClient } from './supabase'

// Acción masiva «Marcar aceptación» del correo masivo (F-CLI-11): `public.marcar_aceptacion_correo_clientes`. Solo el
// administrador (la base lo exige), hasta 5000 clientes de su organización; deja el evento en Actividad con la cantidad y
// quién. Devuelve cuántos cambiaron (los que ya tenían ese valor no cuentan).

export async function marcarAceptacionCorreo(clienteIds: readonly string[], acepta: boolean): Promise<number> {
  const { data, error } = await supabaseClient.rpc('marcar_aceptacion_correo_clientes', {
    p_cliente_ids: [...clienteIds],
    p_acepta: acepta,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export function textoAceptacionMarcada(cambiados: number, elegidos: number, acepta: boolean): string {
  const estado = acepta ? 'aceptan' : 'no aceptan'
  if (cambiados === 0) return `Los ${elegidos} clientes elegidos ya figuraban como que ${estado} el correo masivo.`
  return `Se marcó que ${estado} el correo masivo a ${cambiados} ${cambiados === 1 ? 'cliente' : 'clientes'}.`
}

export function mensajeDeErrorAceptacion(error: unknown, porDefecto: string): string {
  const e = error as { code?: string; message?: string } | null
  if (e?.code === '42501') return 'Solo un administrador puede marcar la aceptación de correo. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}
