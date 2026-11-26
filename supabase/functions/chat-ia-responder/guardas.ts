// Guardas puras de `chat-ia-responder` (sin imports de Deno ni de Supabase: `node --test`, ver guardas.test.ts).
// Se ejecutan ANTES de llamar al proveedor de IA: el crédito de la plataforma no se gasta sin verificar quién es el
// usuario, que tenga la funcionalidad, que la conversación sea suya y que no haya superado su cuota.

export const MENSAJE_MAX = 4000
export const MAX_TOKENS_RESPUESTA = 1024
// Mensajes de usuario por hora y por persona (configurable con CHAT_IA_LIMITE_HORA; ver docs/chat-ia.md).
export const LIMITE_MENSAJES_POR_HORA = 60
export const MAX_HERRAMIENTAS_POR_TURNO = 4
export const MAX_FILTROS = 8
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAVE_FILTRO = /^[a-z_][a-z0-9_]{0,62}$/

export type EntradaChat = { mensaje: string; conversacionId: string | null }

export function validarEntrada(body: unknown): { ok: true; entrada: EntradaChat } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as { mensaje?: unknown; conversacion_id?: unknown }
  if (typeof b.mensaje !== 'string' || !b.mensaje.trim()) return { ok: false, error: 'Falta "mensaje".' }
  if (b.mensaje.length > MENSAJE_MAX) return { ok: false, error: `El mensaje admite hasta ${MENSAJE_MAX} caracteres.` }
  if (b.conversacion_id !== undefined && b.conversacion_id !== null && (typeof b.conversacion_id !== 'string' || !UUID.test(b.conversacion_id))) {
    return { ok: false, error: '"conversacion_id" inválido.' }
  }
  return { ok: true, entrada: { mensaje: b.mensaje, conversacionId: (b.conversacion_id as string | null | undefined) ?? null } }
}

export function excedeLimite(mensajesUltimaHora: number, limite: number = LIMITE_MENSAJES_POR_HORA): boolean {
  return mensajesUltimaHora >= limite
}

// Decisión de la cuota (pura): un error al contarla no deja pasar (503) y el tope corta con 429.
export function rechazoPorCuota(recientes: number | null | undefined, error: unknown, limite: number): { status: number; error: string } | null {
  if (error) return { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
  if (excedeLimite(recientes ?? 0, limite)) return { status: 429, error: 'Superaste el límite de mensajes por hora. Probá de nuevo más tarde.' }
  return null
}

export function limiteConfigurado(valor: string | undefined): number {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : LIMITE_MENSAJES_POR_HORA
}

// Claves de filtro elegidas por el modelo: solo identificadores simples y valores escalares, y pocos.
export function filtrosSeguros(filtros: unknown): { ok: true; filtros: Record<string, string | number> } | { ok: false } {
  if (filtros === undefined || filtros === null) return { ok: true, filtros: {} }
  if (typeof filtros !== 'object' || Array.isArray(filtros)) return { ok: false }
  const entradas = Object.entries(filtros as Record<string, unknown>)
  if (entradas.length > MAX_FILTROS) return { ok: false }
  const limpios: Record<string, string | number> = {}
  for (const [clave, valor] of entradas) {
    if (!CLAVE_FILTRO.test(clave)) return { ok: false }
    if (typeof valor !== 'string' && !(typeof valor === 'number' && Number.isFinite(valor))) return { ok: false }
    limpios[clave] = valor
  }
  return { ok: true, filtros: limpios }
}

const COLUMNA_PERMITIDA = /^[a-z0-9_]+$/
const MAX_COLUMNAS = 50

// Columnas que `fuentes_chat_ia.columnas` autoriza para una vista (MSF-730). `null`/`undefined` conserva el comportamiento
// histórico (`*`, las columnas de la vista). Si está definida debe ser una lista no vacía de identificadores simples
// (`[a-z0-9_]`, sin repetidos, hasta 50): cualquier otro valor falla cerrado (`ok: false`), nunca se arma SQL libre. `permitidas` (null = sin restricción) sirve para limitar también los filtros: filtrar por una columna no autorizada sería un oráculo.
export function columnasParaSelect(columnas: unknown): { ok: true; seleccion: string; permitidas: string[] | null } | { ok: false } {
  if (columnas === null || columnas === undefined) return { ok: true, seleccion: '*', permitidas: null }
  if (!Array.isArray(columnas) || columnas.length === 0 || columnas.length > MAX_COLUMNAS) return { ok: false }
  const vistas = new Set<string>()
  for (const c of columnas) {
    if (typeof c !== 'string' || !COLUMNA_PERMITIDA.test(c) || vistas.has(c)) return { ok: false }
    vistas.add(c)
  }
  return { ok: true, seleccion: columnas.join(','), permitidas: [...vistas] }
}

// Texto que se guarda (y se le muestra al usuario) al proponer una acción. La confirmación humana tiene que ver la
// acción y los parámetros REALES que se ejecutarían, no solo la descripción redactada por el modelo, que puede venir
// influida por datos leídos (inyección de instrucciones).
export function describirPropuesta(rpc: string, parametros: Record<string, unknown>, descripcion: string): string {
  let json: string
  try { json = JSON.stringify(parametros) } catch { json = '{}' }
  const texto = `Acción: ${rpc}\nParámetros: ${json}\nDescripción del asistente (no verificada): ${descripcion}`
  return texto.length > 1500 ? `${texto.slice(0, 1497)}...` : texto
}

type Cliente = { from(tabla: string): { insert(fila: Record<string, unknown>): PromiseLike<{ error: unknown }> } }

export class ErrorPersistencia extends Error {
  constructor() { super('PERSISTENCIA_CHAT_FALLIDA') }
}

// Inserta un mensaje y falla si la base lo rechaza (RLS, conversación ajena, caída): antes el error se ignoraba y la
// función respondía como si todo estuviera guardado.
export async function guardarMensaje(cliente: Cliente, fila: Record<string, unknown>): Promise<void> {
  const { error } = await cliente.from('mensajes_chat_ia').insert(fila)
  if (error) throw new ErrorPersistencia()
}

export type LlamadaHerramienta = { id: string; name: string; input: Record<string, unknown> }
export type ResultadoHerramienta =
  | { tipo: 'propuesta' }
  | { tipo: 'rechazo'; mensaje: string }
  | { tipo: 'resultado'; valor: unknown }
export type ResultadoTurno =
  | { tipo: 'propuesta' }
  | { tipo: 'rechazo'; mensaje: string }
  | { tipo: 'resultados'; resultados: Array<{ id: string; valor: unknown }> }

// Las dos APIs exigen un resultado por CADA llamada a herramienta del turno (si no, 400): se resuelven todas, en
// orden, con un tope. Una propuesta o un rechazo cortan el turno apenas aparecen.
export async function resolverLlamadas(
  llamadas: LlamadaHerramienta[],
  manejar: (nombre: string, input: Record<string, unknown>) => Promise<ResultadoHerramienta>,
): Promise<ResultadoTurno> {
  const resultados: Array<{ id: string; valor: unknown }> = []
  for (const [i, llamada] of llamadas.entries()) {
    if (i >= MAX_HERRAMIENTAS_POR_TURNO) {
      resultados.push({ id: llamada.id, valor: { error: 'DEMASIADAS_HERRAMIENTAS_EN_UN_TURNO' } })
      continue
    }
    const r = await manejar(llamada.name, llamada.input)
    if (r.tipo === 'propuesta') return { tipo: 'propuesta' }
    if (r.tipo === 'rechazo') return { tipo: 'rechazo', mensaje: r.mensaje }
    resultados.push({ id: llamada.id, valor: r.valor })
  }
  return { tipo: 'resultados', resultados }
}
