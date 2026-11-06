// Arma el «Contexto:» del prompt a partir de los fragmentos recuperados (MSF-725).
//
// El texto de los fragmentos se sanea con su propia lista permitida (`texto`), no con la del contrato del consumidor
// (`pregunta`, `organizacion_id`): con esa, `sanitizarDato` descartaba `texto` y el contexto salía vacío. Como el
// contenido de los documentos no es confiable, se envuelve una sola vez con `marcarContenidoNoConfiable`.
import { marcarContenidoNoConfiable, sanitizarDato } from '../_shared/ia/sanitizar.ts'

const CLAVES_FRAGMENTO = ['texto'] as const

export function armarContexto(fragmentos: ReadonlyArray<{ texto?: unknown }>): string | null {
  const textos = fragmentos
    .map((f) => (sanitizarDato({ texto: f.texto }, CLAVES_FRAGMENTO) as { texto?: unknown }).texto)
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
  if (textos.length === 0) return null
  return marcarContenidoNoConfiable(textos.join('\n\n---\n\n'))
}
