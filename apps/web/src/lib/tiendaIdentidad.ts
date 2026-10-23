import { supabaseClient } from './supabase'

// F-TDA-02 (MSF-266): identidad visual de la tienda online (colores, tipografías, logo y banners).
// La base repite estas reglas (checks de color/tipografía, bucket `tienda-identidad`, RPC): acá se
// valida antes para avisar sin ir a la red. Límites por defecto de la spec (D5), en una sola constante.

export const BUCKET_IDENTIDAD = 'tienda-identidad'

// Lista cerrada de tipografías (DS-04, supuesto): la misma que valida la base.
export const TIPOGRAFIAS = ['system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans'] as const
export type Tipografia = (typeof TIPOGRAFIAS)[number]

export type IdentidadTienda = {
  colorPrimario: string
  colorPrimarioOscuro: string
  colorAcento: string
  colorFondo: string
  tipografiaTitulos: Tipografia
  tipografiaTexto: Tipografia
  logoRuta: string | null
  bannerRuta: string | null
  bannerMovilRuta: string | null
}

// Tema base de la tienda sin configurar (mismos valores que los defaults de la tabla).
export const IDENTIDAD_BASE: IdentidadTienda = {
  colorPrimario: '#222222',
  colorPrimarioOscuro: '#000000',
  colorAcento: '#222222',
  colorFondo: '#FFFFFF',
  tipografiaTitulos: 'system-ui',
  tipografiaTexto: 'system-ui',
  logoRuta: null,
  bannerRuta: null,
  bannerMovilRuta: null,
}

export type ClaveImagen = 'logo' | 'banner' | 'bannerMovil'

type ReglasImagen = { tipos: Readonly<Record<string, string>>; maxBytes: number; maxEtiqueta: string; formatos: string; medidas: string | null }

const MB = 1024 * 1024

export const REGLAS_IMAGEN: Readonly<Record<ClaveImagen, ReglasImagen>> = {
  logo: {
    tipos: { 'image/png': 'png', 'image/svg+xml': 'svg' },
    maxBytes: 1 * MB,
    maxEtiqueta: '1 MB',
    formatos: 'PNG o SVG',
    medidas: null,
  },
  banner: {
    tipos: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' },
    maxBytes: 3 * MB,
    maxEtiqueta: '3 MB',
    formatos: 'PNG, JPG o WebP',
    medidas: '1440×440',
  },
  bannerMovil: {
    tipos: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' },
    maxBytes: 3 * MB,
    maxEtiqueta: '3 MB',
    formatos: 'PNG, JPG o WebP',
    medidas: '390×300',
  },
}

export const tiposAceptados = (clave: ClaveImagen) => Object.keys(REGLAS_IMAGEN[clave].tipos).join(',')

// ---------------------------------------------------------------------------
// Colores y contraste (FR-022, FR-023)
// ---------------------------------------------------------------------------

const COLOR_RRGGBB = /^#[0-9A-Fa-f]{6}$/

export const esColorValido = (valor: string) => COLOR_RRGGBB.test(valor.trim())

export const normalizarColor = (valor: string) => valor.trim().toUpperCase()

export const CONTRASTE_MINIMO_AA = 4.5

function luminanciaRelativa(color: string): number {
  const canal = (inicio: number) => {
    const c = parseInt(color.slice(inicio, inicio + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
}

// Contraste WCAG del texto blanco sobre el color dado. null si el color no es #RRGGBB.
export function contrasteBlancoSobre(color: string): number | null {
  if (!esColorValido(color)) return null
  return 1.05 / (luminanciaRelativa(color.trim()) + 0.05)
}

// Una décima hacia abajo y con coma («7,4»): redondear hacia arriba mostraría «4,5» para 4,46 (que no
// cumple AA).
export const formatearContraste = (razon: number) => (Math.floor(razon * 10) / 10).toFixed(1).replace('.', ',')

export type EvaluacionContraste = { razon: number; cumpleAA: boolean; texto: string }

export function evaluarContraste(colorPrimario: string): EvaluacionContraste | null {
  const razon = contrasteBlancoSobre(colorPrimario)
  if (razon === null) return null
  const cumpleAA = razon >= CONTRASTE_MINIMO_AA
  const base = `Contraste de texto blanco sobre el primario: ${formatearContraste(razon)}:1`
  return {
    razon,
    cumpleAA,
    texto: cumpleAA ? `${base} (AA).` : `${base}. No cumple AA (mínimo 4,5:1): el texto blanco puede costar leerse. Podés guardar igual.`,
  }
}

// ---------------------------------------------------------------------------
// Archivos (FR-021, FR-025, FR-026)
// ---------------------------------------------------------------------------

// Deny-list sobre el texto crudo (sin parsear): un parser tolerante acepta `<svg/onload=…>`, así que el
// separador antes de `on*` es cualquier espacio o `/`, y las entidades/comentarios se rechazan de plano.
const EVENTO_EN_ATRIBUTO = /<[^>]*[\s/"'`]on[a-z]+\s*=/i
const ETIQUETA_ACTIVA = /<\s*\/?\s*(?:script|foreignObject|iframe|embed|object|audio|video|animate|set|handler|listener)\b/i
const URL_PELIGROSA = /(?:href|src|action)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i
const ENTIDAD_O_DOCTYPE = /<!\s*(?:ENTITY|DOCTYPE)|&#?[a-z0-9]+;/i
const REFERENCIA_EXTERNA = /(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i

// Un SVG se rechaza si puede ejecutar código: etiquetas activas (script, foreignObject, …), manejadores on*,
// URL javascript:/data:, entidades (ofuscación) o referencias externas. Filtro solo del navegador: ver
// docs/tienda-identidad.md (límites conocidos).
export function svgEsSeguro(contenido: string): boolean {
  return ![ETIQUETA_ACTIVA, EVENTO_EN_ATRIBUTO, URL_PELIGROSA, ENTIDAD_O_DOCTYPE, REFERENCIA_EXTERNA].some((r) => r.test(contenido))
}

function leerTexto(archivo: File): Promise<string> {
  if (typeof archivo.text === 'function') return archivo.text()
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(String(lector.result ?? ''))
    lector.onerror = () => rechazar(lector.error)
    lector.readAsText(archivo)
  })
}

// Mensaje de rechazo del archivo, o null si se puede usar. El tipo sale de `file.type` (lo declara el
// navegador); el SVG además se inspecciona porque es el único formato con contenido ejecutable.
export async function validarImagen(clave: ClaveImagen, archivo: File): Promise<string | null> {
  const reglas = REGLAS_IMAGEN[clave]
  if (!(archivo.type in reglas.tipos)) {
    return `«${archivo.name}» no es un formato admitido. Usá ${reglas.formatos}.`
  }
  if (archivo.size > reglas.maxBytes) {
    return `«${archivo.name}» supera el máximo de ${reglas.maxEtiqueta}.`
  }
  if (archivo.type === 'image/svg+xml') {
    let contenido: string
    try {
      contenido = await leerTexto(archivo)
    } catch {
      return `No pudimos leer «${archivo.name}». Probá con otro archivo.`
    }
    if (!svgEsSeguro(contenido)) {
      return `«${archivo.name}» contiene código (script o eventos) y no se puede usar. Exportalo de nuevo como SVG sin scripts.`
    }
  }
  return null
}

export function rutaArchivo(organizacionId: string, empresaId: string, clave: ClaveImagen, archivo: File): string {
  const extension = REGLAS_IMAGEN[clave].tipos[archivo.type] ?? 'png'
  const prefijo = clave === 'bannerMovil' ? 'banner-movil' : clave
  return `${organizacionId}/${empresaId}/${prefijo}-${crypto.randomUUID()}.${extension}`
}

export function urlPublica(ruta: string | null): string | null {
  if (!ruta) return null
  return supabaseClient.storage.from(BUCKET_IDENTIDAD).getPublicUrl(ruta).data.publicUrl
}

// ---------------------------------------------------------------------------
// Lectura y escritura
// ---------------------------------------------------------------------------

type FilaIdentidad = {
  color_primario: string
  color_primario_oscuro: string
  color_acento: string
  color_fondo: string
  tipografia_titulos: Tipografia
  tipografia_texto: Tipografia
  logo_ruta: string | null
  banner_ruta: string | null
  banner_movil_ruta: string | null
}

const desdeFila = (fila: FilaIdentidad): IdentidadTienda => ({
  colorPrimario: fila.color_primario,
  colorPrimarioOscuro: fila.color_primario_oscuro,
  colorAcento: fila.color_acento,
  colorFondo: fila.color_fondo,
  tipografiaTitulos: fila.tipografia_titulos,
  tipografiaTexto: fila.tipografia_texto,
  logoRuta: fila.logo_ruta,
  bannerRuta: fila.banner_ruta,
  bannerMovilRuta: fila.banner_movil_ruta,
})

const COLUMNAS = 'color_primario, color_primario_oscuro, color_acento, color_fondo, tipografia_titulos, tipografia_texto, logo_ruta, banner_ruta, banner_movil_ruta'

export type IdentidadDeEmpresa = { organizacionId: string; identidad: IdentidadTienda }

// Identidad guardada de una empresa para la gestión (RLS: solo la organización de la sesión). Sin fila
// devuelve el tema base. La empresa se lee aparte porque da la carpeta (organización) de los archivos.
export async function leerIdentidadDeEmpresa(empresaId: string): Promise<IdentidadDeEmpresa> {
  const { data: empresa, error: errorEmpresa } = await supabaseClient
    .schema('dominio')
    .from('empresas')
    .select('organizacion_id')
    .eq('id', empresaId)
    .maybeSingle<{ organizacion_id: string }>()
  if (errorEmpresa) throw new Error(errorEmpresa.message)
  if (!empresa) throw new Error('La empresa no existe')

  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('tienda_identidad')
    .select(COLUMNAS)
    .eq('empresa_id', empresaId)
    .maybeSingle<FilaIdentidad>()
  if (error) throw new Error(error.message)
  return { organizacionId: empresa.organizacion_id, identidad: data ? desdeFila(data) : IDENTIDAD_BASE }
}

// «Guardar»: estado completo por la RPC (idempotente). Devuelve lo que quedó guardado.
export async function guardarIdentidad(empresaId: string, identidad: IdentidadTienda): Promise<IdentidadTienda> {
  const { data, error } = await supabaseClient.rpc('guardar_tienda_identidad', {
    p_empresa_id: empresaId,
    p_color_primario: identidad.colorPrimario,
    p_color_primario_oscuro: identidad.colorPrimarioOscuro,
    p_color_acento: identidad.colorAcento,
    p_color_fondo: identidad.colorFondo,
    p_tipografia_titulos: identidad.tipografiaTitulos,
    p_tipografia_texto: identidad.tipografiaTexto,
    p_logo_ruta: identidad.logoRuta,
    p_banner_ruta: identidad.bannerRuta,
    p_banner_movil_ruta: identidad.bannerMovilRuta,
  })
  if (error) throw new Error(error.message)
  return desdeFila(data as FilaIdentidad)
}

export async function subirImagen(ruta: string, archivo: File): Promise<void> {
  const { error } = await supabaseClient.storage.from(BUCKET_IDENTIDAD).upload(ruta, archivo, { contentType: archivo.type })
  if (error) throw new Error(error.message)
}

// Limpieza de archivos que ya no se usan. No interrumpe: un huérfano no rompe nada, solo ocupa lugar.
export async function borrarImagenes(rutas: string[]): Promise<void> {
  if (rutas.length === 0) return
  const { error } = await supabaseClient.storage.from(BUCKET_IDENTIDAD).remove(rutas)
  if (error) console.error('No se pudieron borrar archivos de identidad sin uso', error.message)
}

// Identidad pública por host (FR-030): `publico.identidad_por_dominio`, ejecutable por anon. Sin
// filas (dominio desconocido o empresa desactivada) devuelve null.
export async function resolverIdentidadPublica(host: string): Promise<IdentidadTienda | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('identidad_por_dominio', { host })
  if (error) throw new Error(error.message)
  const fila = ((data ?? []) as FilaIdentidad[])[0]
  return fila ? desdeFila(fila) : null
}

// Familias de Google Fonts a cargar para una identidad (la tipografía del sistema no necesita carga).
export function familiasACargar(identidad: Pick<IdentidadTienda, 'tipografiaTitulos' | 'tipografiaTexto'>): string[] {
  return [...new Set([identidad.tipografiaTitulos, identidad.tipografiaTexto])].filter((familia) => familia !== 'system-ui')
}

// URL de la hoja de estilos de Google Fonts para esas familias (solo familias de la lista cerrada).
export function urlFuentes(familias: readonly string[]): string | null {
  const validas = familias.filter((familia): familia is Tipografia => (TIPOGRAFIAS as readonly string[]).includes(familia) && familia !== 'system-ui')
  if (validas.length === 0) return null
  const parametros = validas.map((familia) => `family=${encodeURIComponent(familia).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')
  return `https://fonts.googleapis.com/css2?${parametros}&display=swap`
}
