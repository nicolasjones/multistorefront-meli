// Reglas puras de `indexar-documento` (sin imports de Deno ni de Supabase: se prueban con `node --test`).
export const TAMANO_FRAGMENTO = 1200
export const SOLAPAMIENTO = 200
// Tope de fragmentos por documento (~2,4 MB de texto): acota costo de embeddings y tiempo de la invocación.
export const MAX_FRAGMENTOS = 2000
// Una reclamación más vieja que esto se considera abandonada (isolate cortado a mitad): otro intento puede retomar la versión.
export const RECLAMO_VENCE_MS = 10 * 60 * 1000
const PREFIJO_RECLAMO = 'indexando:'

export function fragmentarTexto(texto: string): string[] {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (!limpio) return []
  const fragmentos: string[] = []
  let inicio = 0
  while (inicio < limpio.length) {
    const fin = Math.min(inicio + TAMANO_FRAGMENTO, limpio.length)
    const fragmento = limpio.slice(inicio, fin).trim()
    if (fragmento) fragmentos.push(fragmento)
    if (fin >= limpio.length) break
    inicio = fin - SOLAPAMIENTO
  }
  return fragmentos
}

// El candado de la indexación vive en `versiones_documento.motivo_error` mientras la versión está `procesando`
// (la tabla no tiene un estado «indexando» ni columna de bloqueo; agregarlos exige una migración, ver docs).
export const nuevoReclamo = (ahora: number, id: string) => `${PREFIJO_RECLAMO}${ahora}:${id}`

export function reclamoVigente(motivoError: string | null | undefined, ahora: number): boolean {
  if (!motivoError?.startsWith(PREFIJO_RECLAMO)) return false
  const desde = Number(motivoError.slice(PREFIJO_RECLAMO.length).split(':')[0])
  return Number.isFinite(desde) && ahora - desde < RECLAMO_VENCE_MS
}

// Roles que pueden gestionar documentos RAG (los mismos que `private.puede_gestionar_documentos()`; lista blanca).
export const ROLES_ESCRITORES_DOCUMENTOS = ['administrador', 'operador', 'mostrador', 'deposito', 'administracion', 'tecnico'] as const
export const puedeGestionarDocumentos = (contexto: { rol_efectivo: string | null; es_superadmin: boolean } | null): boolean =>
  !!contexto && (contexto.es_superadmin || (ROLES_ESCRITORES_DOCUMENTOS as readonly string[]).includes(contexto.rol_efectivo ?? ''))
