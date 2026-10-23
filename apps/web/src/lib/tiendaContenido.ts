import { supabaseClient } from './supabase'

// F-TDA-03 (MSF-294): contenido y textos comerciales de la tienda. La base es la fuente de verdad
// de los límites (dominio.tienda_contenido, D5); acá se espejan solo para avisar por campo antes de
// pedirle algo imposible a la RPC. Todos los textos son texto plano: se renderizan siempre
// escapados (React) y un texto vacío oculta su elemento (FR-033, FR-034).

export type ClaveCampoContenido =
  | 'titulo'
  | 'subtitulo'
  | 'texto_boton'
  | 'bienvenida'
  | 'pie'
  | 'aviso_ficha'
  | 'texto_boton_contacto'

export type DestinoBoton = 'catalogo'

export type ContenidoTienda = Record<ClaveCampoContenido, string> & { boton_destino: DestinoBoton }

// Lista cerrada del destino del botón (D4). Hoy una sola opción; MSF-167 puede ampliarla.
export const DESTINOS_BOTON: ReadonlyArray<{ valor: DestinoBoton; etiqueta: string }> = [
  { valor: 'catalogo', etiqueta: 'Catálogo completo' },
]

// El catálogo navegable es de MSF-167: hasta entonces el botón apunta al ancla de la sección de productos.
export const ENLACE_DESTINO_BOTON: Record<DestinoBoton, string> = { catalogo: '#catalogo' }

export const CAMPOS_CONTENIDO: ReadonlyArray<{
  clave: ClaveCampoContenido
  etiqueta: string
  limite: number
  multilinea?: boolean
}> = [
  { clave: 'titulo', etiqueta: 'Título', limite: 120 },
  { clave: 'subtitulo', etiqueta: 'Subtítulo', limite: 300, multilinea: true },
  { clave: 'texto_boton', etiqueta: 'Texto del botón', limite: 120 },
  { clave: 'bienvenida', etiqueta: 'Mensaje de bienvenida (barra superior)', limite: 300 },
  { clave: 'pie', etiqueta: 'Texto del pie de página', limite: 300 },
  { clave: 'aviso_ficha', etiqueta: 'Aviso en la ficha de producto', limite: 300 },
  { clave: 'texto_boton_contacto', etiqueta: 'Texto del botón de contacto', limite: 120 },
]

export const CONTENIDO_VACIO: ContenidoTienda = {
  titulo: '',
  subtitulo: '',
  texto_boton: '',
  boton_destino: 'catalogo',
  bienvenida: '',
  pie: '',
  aviso_ficha: '',
  texto_boton_contacto: '',
}

export type ErroresContenido = Partial<Record<ClaveCampoContenido | 'boton_destino', string>>

export function mensajeLimite(etiqueta: string, limite: number): string {
  return `${etiqueta} no puede superar los ${limite} caracteres.`
}

// Error por campo (FR-033). Los espacios de los extremos no cuentan: la base los recorta.
export function validarContenido(valores: ContenidoTienda): ErroresContenido {
  const errores: ErroresContenido = {}
  for (const campo of CAMPOS_CONTENIDO) {
    if (valores[campo.clave].trim().length > campo.limite) {
      errores[campo.clave] = mensajeLimite(campo.etiqueta, campo.limite)
    }
  }
  if (!DESTINOS_BOTON.some((destino) => destino.valor === valores.boton_destino)) {
    errores.boton_destino = 'Elegí un destino de la lista.'
  }
  return errores
}

export function contenidoIgual(a: ContenidoTienda, b: ContenidoTienda): boolean {
  return a.boton_destino === b.boton_destino && CAMPOS_CONTENIDO.every((campo) => a[campo.clave].trim() === b[campo.clave].trim())
}

type FilaContenido = Partial<Record<ClaveCampoContenido | 'boton_destino', string | null>>

function aContenido(fila: FilaContenido | null | undefined): ContenidoTienda {
  const destino = DESTINOS_BOTON.some((d) => d.valor === fila?.boton_destino) ? (fila?.boton_destino as DestinoBoton) : 'catalogo'
  return {
    titulo: fila?.titulo ?? '',
    subtitulo: fila?.subtitulo ?? '',
    texto_boton: fila?.texto_boton ?? '',
    boton_destino: destino,
    bienvenida: fila?.bienvenida ?? '',
    pie: fila?.pie ?? '',
    aviso_ficha: fila?.aviso_ficha ?? '',
    texto_boton_contacto: fila?.texto_boton_contacto ?? '',
  }
}

const COLUMNAS = 'titulo, subtitulo, texto_boton, boton_destino, bienvenida, pie, aviso_ficha, texto_boton_contacto'

// Contenido guardado de la empresa para la gestión. RLS de dominio.tienda_contenido: solo la
// organización de la sesión. Sin fila = todo vacío (la tienda no muestra textos opcionales).
export async function leerContenido(empresaId: string): Promise<ContenidoTienda> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('tienda_contenido')
    .select(COLUMNAS)
    .eq('empresa_id', empresaId)
    .maybeSingle<FilaContenido>()
  if (error) {
    throw new Error(error.message)
  }
  return aContenido(data)
}

// Error de guardado: `campo` es el campo que rechazó la base (hint de la RPC), si lo hay.
export class ErrorGuardadoContenido extends Error {
  campo: ClaveCampoContenido | 'boton_destino' | null
  constructor(mensaje: string, campo: string | null | undefined) {
    super(mensaje)
    this.name = 'ErrorGuardadoContenido'
    const conocido = campo === 'boton_destino' || CAMPOS_CONTENIDO.some((c) => c.clave === campo)
    this.campo = conocido ? (campo as ClaveCampoContenido | 'boton_destino') : null
  }
}

// «Guardar» aplica de inmediato a la tienda pública (FR-035). Idempotente en la base.
export async function guardarContenido(empresaId: string, valores: ContenidoTienda): Promise<ContenidoTienda> {
  const { data, error } = await supabaseClient.rpc('guardar_tienda_contenido', {
    p_empresa_id: empresaId,
    p_titulo: valores.titulo,
    p_subtitulo: valores.subtitulo,
    p_texto_boton: valores.texto_boton,
    p_boton_destino: valores.boton_destino,
    p_bienvenida: valores.bienvenida,
    p_pie: valores.pie,
    p_aviso_ficha: valores.aviso_ficha,
    p_texto_boton_contacto: valores.texto_boton_contacto,
  })
  if (error) {
    throw new ErrorGuardadoContenido(error.message, (error as { hint?: string | null }).hint)
  }
  return aContenido(data as FilaContenido)
}

// publico.contenido_por_dominio es ejecutable por anon: no hace falta sesión. Cero filas
// (dominio desconocido o empresa desactivada) → null.
// Las tres secciones de la home piden el mismo contenido: se comparte una sola petición por host.
const PETICIONES_PUBLICAS = new Map<string, Promise<ContenidoTienda | null>>()

export function leerContenidoPublico(host: string): Promise<ContenidoTienda | null> {
  const existente = PETICIONES_PUBLICAS.get(host)
  if (existente) return existente
  const peticion = (async () => {
    const { data, error } = await supabaseClient.schema('publico').rpc('contenido_por_dominio', { host })
    if (error) {
      throw new Error(error.message)
    }
    const fila = ((data ?? []) as FilaContenido[])[0]
    return fila ? aContenido(fila) : null
  })()
  PETICIONES_PUBLICAS.set(host, peticion)
  // Un fallo no se queda en la caché: la próxima sección o recarga reintenta.
  peticion.catch(() => PETICIONES_PUBLICAS.delete(host))
  return peticion
}

export function reiniciarContenidoPublico(): void {
  PETICIONES_PUBLICAS.clear()
}
