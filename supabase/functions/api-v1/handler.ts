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

export type Limite = { permitido: boolean; reintentar_en_seg: number; restantes: number }

export type Lectura = { filas: unknown[]; siguiente_cursor: string | null }

export type Llamada = {
  clave_id: string | null
  organizacion_id: string | null
  metodo: string
  ruta: string
  version: string
  estado_http: number
  duracion_ms: number
}

export type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

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
    headers: { 'Content-Type': 'application/json', ...cabeceras },
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

type Resolucion = {
  estado: number
  cuerpo: unknown
  codigo: CodigoError | null
  clave_id: string | null
  organizacion_id: string | null
  cabeceras: Record<string, string>
}

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

  const autorizacion = req.headers.get('authorization')
  if (!autorizacion) {
    return { ...base, estado: 401, cuerpo: cuerpoError('token_ausente'), codigo: 'token_ausente' }
  }
  const token = autorizacion.startsWith('Bearer ') ? autorizacion.slice('Bearer '.length).trim() : ''
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

  const params = url.searchParams
  const limitePedido = parsearLimite(params.get('limite'))
  if (limitePedido === null) {
    return { ...conClave, estado: 400, cuerpo: cuerpoError('parametro_invalido'), codigo: 'parametro_invalido' }
  }
  const actualizadoDesde = params.get('actualizado_desde')
  if (actualizadoDesde && Number.isNaN(Date.parse(actualizadoDesde))) {
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
  // falla de auditoría no puede cambiar la respuesta del llamador.
  try {
    await deps.registrarLlamada({
      clave_id: resolucion.clave_id,
      organizacion_id: resolucion.organizacion_id,
      metodo: req.method,
      ruta,
      version,
      estado_http: resolucion.estado,
      duracion_ms: Date.now() - inicio,
    })
  } catch (error) {
    console.error('api-v1: no se pudo auditar la llamada', error)
  }

  return respuesta(resolucion.cuerpo, resolucion.estado, resolucion.cabeceras)
}
