// Lógica de la API pública v1 (F-API-01, FR-003, FR-004, FR-009) con
// dependencias inyectadas para probarla sin Deno ni Supabase
// (`handler.test.ts`). `index.ts` solo cablea el cliente real.
//
// La API es de SOLO LECTURA. La organización sale SIEMPRE de la clave de API:
// ningún parámetro del llamador puede cambiarla (FR-003). El filtro de
// organización lo arma el SQL de lectura (FR-006), no este archivo.
//
// El error es uniforme: `{ "error": { "codigo": "...", "mensaje": "..." } }`.
// Los mensajes nunca incluyen el token, el hash ni detalles internos.

export type Alcance = 'productos' | 'stock' | 'precios' | 'ventas'

/** Rutas de lectura y el alcance que exigen. */
export const RUTAS: Record<string, { alcance: Alcance }> = {
  '/v1/productos': { alcance: 'productos' },
  '/v1/stock': { alcance: 'stock' },
  '/v1/precios': { alcance: 'precios' },
  '/v1/ventas': { alcance: 'ventas' },
}

/** El contrato se sirve sin clave: es público por definición. */
export const RUTA_CONTRATO = '/v1/openapi.json'

const ERRORES = {
  token_ausente: 'Falta la cabecera Authorization con la clave de API.',
  token_invalido: 'La clave de API no es válida.',
  clave_vencida: 'La clave de API venció.',
  clave_revocada: 'La clave de API está revocada.',
  alcance_insuficiente: 'La clave de API no tiene alcance para esta ruta.',
  limite_excedido: 'Se superó el límite de uso de la clave de API.',
  cursor_invalido: 'El cursor de paginación no es válido.',
  parametro_invalido: 'Algún parámetro de la consulta no es válido.',
  no_encontrado: 'La ruta no existe.',
  metodo_no_soportado: 'La API es de solo lectura.',
  error_interno: 'No se pudo completar la llamada.',
} as const

export type CodigoError = keyof typeof ERRORES

export type Validacion = {
  valida: boolean
  clave_id: string | null
  organizacion_id: string | null
  alcances: string[] | null
  limite_por_minuto: number | null
  motivo: string | null
}

// `reserva_id`: la fila de auditoría que el control de límite reservó dentro del lock; la llamada la completa al terminar.
export type Limite = { permitido: boolean; reintentar_en_seg: number; restantes: number; reserva_id?: string | null }

export type Lectura = { filas: unknown[]; siguiente_cursor: string | null }

export type Llamada = {
  clave_id: string | null
  organizacion_id: string | null
  metodo: string
  ruta: string
  version: string
  estado_http: number
  duracion_ms: number
  reserva_id?: string | null
}

export type Resultado<T> = Promise<{ data: T; error: { message: string; code?: string } | null }>

export type Deps = {
  /** Contrato OpenAPI que se sirve en `GET /v1/openapi.json`. */
  openapi: () => Promise<unknown>
  validarClave: (token: string) => Resultado<Validacion[] | null>
  controlarLimite: (claveId: string) => Resultado<Limite[] | null>
  registrarLlamada: (llamada: Llamada) => Resultado<null>
  leer: (
    recurso: Alcance,
    organizacionId: string,
    cursor: string | null,
    limite: number,
    actualizadoDesde: string | null,
  ) => Resultado<Lectura[] | null>
}

/** La Edge Function se sirve bajo `/api-v1`: la ruta de la API es lo que va después. */
export function rutaRelativa(pathname: string): string {
  const i = pathname.lastIndexOf('/api-v1')
  return i >= 0 ? pathname.slice(i + '/api-v1'.length) : pathname
}

/** La versión va en la ruta: `/v1/productos` → `v1`. */
export function versionDe(ruta: string): string | null {
  const m = /^\/(v\d+)\//.exec(ruta)
  return m ? m[1] : null
}

function respuesta(cuerpo: unknown, estado: number, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    // Datos de una organización: nunca se cachean ni se interpretan como otro tipo.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cabeceras },
  })
}

function cuerpoError(codigo: CodigoError): { error: { codigo: string; mensaje: string } } {
  return { error: { codigo, mensaje: ERRORES[codigo] } }
}

/**
 * Versiones retiradas: si el documento OpenAPI declara `x-versions-retiradas`,
 * la respuesta de esa versión lleva `Deprecation` y `Sunset` (D-4: aviso
 * mínimo de 6 meses).
 */
function cabecerasDeVersion(documento: unknown, version: string | null): Record<string, string> {
  if (!version || !documento || typeof documento !== 'object') return {}
  const retiradas = (documento as Record<string, unknown>)['x-versions-retiradas']
  if (!retiradas || typeof retiradas !== 'object') return {}
  const retirada = (retiradas as Record<string, unknown>)[version]
  if (!retirada || typeof retirada !== 'object') return {}
  const { deprecacion, sunset } = retirada as { deprecacion?: string; sunset?: string }
  return deprecacion && sunset ? { Deprecation: deprecacion, Sunset: sunset } : {}
}

function parsearLimite(valor: string | null): number | null {
  if (valor === null || valor === '') return 50
  if (!/^\d+$/.test(valor)) return null
  const limite = Number(valor)
  return limite >= 1 && limite <= 100 ? limite : null
}

/**
 * `actualizado_desde` es ISO-8601 **con zona** (`2027-01-05T00:00:00Z` o
 * `...-03:00`). Un `Date.parse` laxo acepta «01/02/2027» o «2027» y las
 * interpretaría en la zona del servidor: el filtro caería en un instante
 * distinto del que el cliente cree (FR-004).
 */
const ISO_8601_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

function esIsoConZona(valor: string): boolean {
  return ISO_8601_CON_ZONA.test(valor) && !Number.isNaN(Date.parse(valor))
}

type Resolucion = {
  estado: number
  cuerpo: unknown
  codigo: CodigoError | null
  clave_id: string | null
  organizacion_id: string | null
  // Fila de auditoría reservada por el control de límite (solo si la llamada pasó el límite).
  reserva_id?: string | null
  cabeceras: Record<string, string>
}

/**
 * El SQL de lectura rechaza un cursor que no trae la clave esperada con
 * `CURSOR_INVALIDO` (SQLSTATE 22023). Un cursor base64 válido con partes que
 * no son numéricas/uuid revienta al castear (SQLSTATE 22P02). Para el
 * llamador ambos son un parámetro inválido, no un fallo del servidor:
 * responde 400 (FR-004).
 */
function esCursorInvalido(error: { message: string; code?: string } | null): boolean {
  if (!error) return false
  if (error.code === '22P02') return true
  if (error.code !== '22023') return false
  return !/LIMITE_INVALIDO/.test(error.message)
}

/**
 * La clave de API puede viajar en `Authorization: Bearer` (cuando el gateway
 * de Supabase no valida el JWT de la función) o en `X-API-Key`, para que un
 * cliente externo pueda mandar la clave anónima en `Authorization` y dejar que
 * el gateway la valide sin exponer la clave de API a otro esquema.
 */
function tokenDeApi(req: Request): string | null {
  const clave = req.headers.get('x-api-key')?.trim()
  if (clave) return clave
  const autorizacion = req.headers.get('authorization')
  if (!autorizacion) return null
  return autorizacion.startsWith('Bearer ') ? autorizacion.slice('Bearer '.length).trim() : ''
}

/** `api_llamadas.ruta` admite 200 caracteres: la auditoría nunca pierde una llamada. */
const RUTA_AUDITADA_MAX = 200

async function resolver(req: Request, deps: Deps, documento: unknown): Promise<Resolucion> {
  const url = new URL(req.url)
  const ruta = rutaRelativa(url.pathname)
  const metodo = req.method
  const version = versionDe(ruta) ?? 'v1'
  const cabeceras = cabecerasDeVersion(documento, versionDe(ruta))

  const base = { clave_id: null, organizacion_id: null, cabeceras }

  if (ruta === RUTA_CONTRATO) {
    if (metodo !== 'GET') {
      return { ...base, estado: 405, cuerpo: cuerpoError('metodo_no_soportado'), codigo: 'metodo_no_soportado' }
    }
    return { ...base, estado: 200, cuerpo: documento, codigo: null }
  }

  const recurso = RUTAS[ruta]
  if (!recurso) {
    return { ...base, estado: 404, cuerpo: cuerpoError('no_encontrado'), codigo: 'no_encontrado' }
  }

  if (metodo !== 'GET') {
    return { ...base, estado: 405, cuerpo: cuerpoError('metodo_no_soportado'), codigo: 'metodo_no_soportado' }
  }

  const token = tokenDeApi(req)
  if (token === null) {
    return { ...base, estado: 401, cuerpo: cuerpoError('token_ausente'), codigo: 'token_ausente' }
  }
  if (!token) {
    return { ...base, estado: 401, cuerpo: cuerpoError('token_invalido'), codigo: 'token_invalido' }
  }

  const { data: validaciones, error: errorValidacion } = await deps.validarClave(token)
  if (errorValidacion) {
    return { ...base, estado: 500, cuerpo: cuerpoError('error_interno'), codigo: 'error_interno' }
  }

  const validacion = validaciones?.[0]
  if (!validacion || !validacion.valida) {
    const motivo = (validacion?.motivo ?? 'token_invalido') as CodigoError
    return {
      ...base,
      estado: 401,
      cuerpo: cuerpoError(motivo in ERRORES ? motivo : 'token_invalido'),
      codigo: motivo in ERRORES ? motivo : 'token_invalido',
      clave_id: validacion?.clave_id ?? null,
      organizacion_id: validacion?.organizacion_id ?? null,
    }
  }

  const conClave = {
    ...base,
    clave_id: validacion.clave_id,
    organizacion_id: validacion.organizacion_id,
    // Se completa al pasar el límite.
    reserva_id: null as string | null,
  }

  if (!validacion.alcances?.includes(recurso.alcance)) {
    return { ...conClave, estado: 403, cuerpo: cuerpoError('alcance_insuficiente'), codigo: 'alcance_insuficiente' }
  }

  const { data: limites, error: errorLimite } = await deps.controlarLimite(validacion.clave_id ?? '')
  if (errorLimite || !limites?.length) {
    return { ...conClave, estado: 500, cuerpo: cuerpoError('error_interno'), codigo: 'error_interno' }
  }
  const limite = limites[0]
  if (!limite.permitido) {
    return {
      ...conClave,
      estado: 429,
      cuerpo: cuerpoError('limite_excedido'),
      codigo: 'limite_excedido',
      cabeceras: { ...cabeceras, 'Retry-After': String(Math.max(1, limite.reintentar_en_seg)) },
    }
  }

  // La llamada pasó el límite: queda su lugar reservado y se completa al terminar (`reserva_id`).
  conClave.reserva_id = limite.reserva_id ?? null

  const params = url.searchParams
  const limitePedido = parsearLimite(params.get('limite'))
  if (limitePedido === null) {
    return { ...conClave, estado: 400, cuerpo: cuerpoError('parametro_invalido'), codigo: 'parametro_invalido' }
  }
  const actualizadoDesde = params.get('actualizado_desde')
  if (actualizadoDesde && !esIsoConZona(actualizadoDesde)) {
    return { ...conClave, estado: 400, cuerpo: cuerpoError('parametro_invalido'), codigo: 'parametro_invalido' }
  }

  const { data: lecturas, error: errorLectura } = await deps.leer(
    recurso.alcance,
    validacion.organizacion_id ?? '',
    params.get('cursor'),
    limitePedido,
    actualizadoDesde,
  )
  if (errorLectura || !lecturas?.length) {
    if (esCursorInvalido(errorLectura)) {
      return { ...conClave, estado: 400, cuerpo: cuerpoError('cursor_invalido'), codigo: 'cursor_invalido' }
    }
    return { ...conClave, estado: 500, cuerpo: cuerpoError('error_interno'), codigo: 'error_interno' }
  }

  const lectura = lecturas[0]
  return {
    ...conClave,
    estado: 200,
    cuerpo: { datos: lectura.filas, siguiente_cursor: lectura.siguiente_cursor },
    codigo: null,
  }
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  const inicio = Date.now()
  const url = new URL(req.url)
  const ruta = rutaRelativa(url.pathname)
  const version = versionDe(ruta) ?? 'v1'

  let documento: unknown = null
  try {
    documento = await deps.openapi()
  } catch (error) {
    console.error('api-v1: no se pudo cargar el contrato OpenAPI', error)
  }

  const resolucion = await resolver(req, deps, documento)

  // Toda llamada queda auditada, incluidas las rechazadas (FR-008). Una
  // falla de auditoría no puede cambiar la respuesta del llamador, pero sí se
  // registra: la RPC devuelve el error en vez de lanzarlo.
  try {
    const { error: errorAuditoria } = await deps.registrarLlamada({
      clave_id: resolucion.clave_id,
      organizacion_id: resolucion.organizacion_id,
      metodo: req.method,
      ruta: ruta.slice(0, RUTA_AUDITADA_MAX),
      version,
      estado_http: resolucion.estado,
      duracion_ms: Date.now() - inicio,
      reserva_id: resolucion.reserva_id ?? null,
    })
    if (errorAuditoria) console.error('api-v1: no se pudo auditar la llamada', errorAuditoria)
  } catch (error) {
    console.error('api-v1: no se pudo auditar la llamada', error)
  }

  return respuesta(resolucion.cuerpo, resolucion.estado, resolucion.cabeceras)
}
