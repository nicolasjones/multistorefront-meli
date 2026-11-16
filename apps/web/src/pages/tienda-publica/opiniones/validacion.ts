// Espejo en el cliente de `private.validar_texto_opinion` y `private.texto_opinion_no_permitido` (MSF-467, RF-OPI-5): sirve para
// avisar antes de enviar, no para decidir. El servidor manda siempre (mide en caracteres de Postgres y ante cualquier diferencia
// rechaza). Mismos casos que `opiniones_validacion.test.sql`. Es una heurística (ver «Limitaciones conocidas» de la spec).

export const COMENTARIO_MINIMO = 10
export const COMENTARIO_MAXIMO = 1000

export type CampoOpinion = 'puntuacion' | 'comentario'

// Control (`[[:cntrl:]]` de Postgres: C0, DEL y C1) y, aparte, separadores de línea y párrafo, ancho cero y marcas de dirección
// (el rango explícito del servidor).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const OCULTOS = /[\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/
const ESQUEMA_O_WWW = /(https?|ftp)\s*:|www\s*\./i
const TLD_LISTA = 'com|net|org|info|biz|edu|gov|mil|int|name|pro|app|dev|shop|store|site|online|link|xyz|top|club|ink|page|tech|live|cloud|blog|news|mobi|agency|website|space|fun|vip|icu|work|win|bid|click|stream|ar|mx|cl|uy|br|co|pe|py|bo|ec|us|uk|fr|ly|tv|cc|ws|gl|gg|be|ee|fm|gd|gy|sh|vc|ph|pt|ru|cn|jp|au|nz|ca|nl|ch|pl|tr'
const DOMINIO_CON_TLD = new RegExp(`[\\p{L}\\p{N}-]\\.(${TLD_LISTA})([^\\p{L}\\p{N}]|$)`, 'iu')
const TLD_AMBIGUO = /([\p{L}\p{N}-]{4}|[-\p{N}])\.(es|me|de|to|it|at|in|se|ve)([^\p{L}\p{N}\s]|$)/iu
const DOMINIO_CON_BARRA = /[\p{L}\p{N}-]\.\p{L}{2,}\//iu

// Puntos de otras escrituras que el servidor normaliza al punto ASCII antes de evaluar.
const normalizarPuntos = (texto: string): string => texto.replace(/[。．｡․﹒]/g, '.')

export function textoOpinionNoPermitido(texto: string): boolean {
  const x = normalizarPuntos(texto)
  return CONTROL.test(x) || OCULTOS.test(x) || ESQUEMA_O_WWW.test(x) || DOMINIO_CON_TLD.test(x) || TLD_AMBIGUO.test(x) || DOMINIO_CON_BARRA.test(x)
}

// Largo en caracteres (puntos de código): el servidor cuenta caracteres de Postgres, no unidades UTF-16.
export const largoComentario = (texto: string): number => [...texto.trim()].length

export type ResultadoValidacion = { ok: boolean; campos: CampoOpinion[]; comentario: string }

export function validarOpinion(puntuacion: number | null, comentario: string): ResultadoValidacion {
  const texto = comentario.trim()
  const campos: CampoOpinion[] = []
  if (puntuacion === null || !Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) campos.push('puntuacion')
  const largo = largoComentario(texto)
  if (largo < COMENTARIO_MINIMO || largo > COMENTARIO_MAXIMO || textoOpinionNoPermitido(texto)) campos.push('comentario')
  return { ok: campos.length === 0, campos, comentario: texto }
}
