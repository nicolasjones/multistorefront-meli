// Construcción de las consultas a la base de `indexar-documento`, aparte de `index.ts` (que corre en Deno con `npm:` y no
// se importa desde `node --test`): así los filtros que protegen la versión (`estado` y reclamo) tienen test propio con un
// cliente simulado que los registra. Sin imports: el cliente real de supabase-js lo cumple estructuralmente.

// Lo mínimo del cliente que usan estas consultas (los métodos encadenables de supabase-js).
// deno-lint-ignore no-explicit-any
export type Cliente = { from(tabla: string): any; rpc(nombre: string, args: Record<string, unknown>): any }

// Reclama la versión (compare-and-swap): solo si sigue `procesando` y con el motivo previo esperado.
export function consultaReclamar(cliente: Cliente, id: string, motivoPrevio: string | null, reclamo: string) {
  const q = cliente.from('versiones_documento').update({ motivo_error: reclamo }).eq('id', id).eq('estado', 'procesando')
  return (motivoPrevio === null ? q.is('motivo_error', null) : q.eq('motivo_error', motivoPrevio)).select('id')
}

// Suelta el reclamo propio (solo si sigue siendo el propio y la versión sigue `procesando`).
export function consultaSoltar(cliente: Cliente, id: string, reclamo: string) {
  return cliente.from('versiones_documento').update({ motivo_error: null }).eq('id', id).eq('estado', 'procesando').eq('motivo_error', reclamo)
}

// Solo mientras sigue `procesando` con el reclamo propio: una versión ya activa (o retomada) nunca se pisa a `fallida`.
export function consultaMarcarFallida(cliente: Cliente, id: string, motivo: string, reclamo: string) {
  return cliente.from('versiones_documento').update({ estado: 'fallida', motivo_error: motivo }).eq('id', id).eq('estado', 'procesando').eq('motivo_error', reclamo).select('id')
}

// Borrado de fragmentos condicional en SQL (cliente de servicio): solo si la versión sigue en manos de este reclamo.
export function llamarBorrarFragmentosSiDueno(cliente: Cliente, versionId: string, reclamo: string) {
  return cliente.rpc('borrar_fragmentos_si_dueno', { p_version_id: versionId, p_reclamo: reclamo })
}
