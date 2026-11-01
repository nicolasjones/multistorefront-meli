// Lógica de `consultar-estado-reparacion` (F-SVC-22, FR-042…FR-044) con dependencias inyectadas para probarla sin
// Deno ni Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
// Es el ÚNICO camino público al estado de una reparación: sin sesión, con la service-role solo en el servidor.
// Orden: (1) cuenta la consulta por IP hasheada (toda consulta, válida o no) y corta con 429 antes de tocar las
// reparaciones; (2) valida el formato del token; (3) consulta. Token mal formado o desconocido → 404 uniforme.
import { createHmac } from 'node:crypto'

export const VENTANA_SEG = 600
export const LIMITE_CONSULTAS = 30
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{32}$/
const IP_FIJA = 'sin-ip'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const seguridadHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }
const response = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...seguridadHeaders, 'Content-Type': 'application/json', ...extra } })

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type Limite = { permitido: boolean; restantes: number; reintentar_en: number }

export type Deps = {
  /** Sal de servidor del hash de la IP (SEGUIMIENTO_IP_SALT); sin ella la función no atiende. */
  sal: string | undefined
  datos: {
    registrarConsulta(ipHash: string, ventanaSeg: number, limite: number): Resultado<Limite | null>
    estadoPublico(token: string): Resultado<unknown>
  }
}

// IP del cliente según el proxy del VPS: `x-real-ip` si la fija el proxy; si no, el último salto de
// `x-forwarded-for` (el que agregó nuestro proxy; los anteriores los puede inventar el cliente).
export function ipDelPedido(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const reenviadas = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return reenviadas.length ? reenviadas[reenviadas.length - 1] : IP_FIJA
}

const texto = (v: unknown) => (typeof v === 'string' ? v : null)

// Lista blanca (FR-044): aunque la base devolviera más, solo sale esto.
export function listaBlanca(bruto: unknown) {
  const o = (bruto ?? {}) as Record<string, unknown>
  const estado = (o.estado ?? {}) as Record<string, unknown>
  const linea = Array.isArray(o.linea_de_tiempo) ? o.linea_de_tiempo as Record<string, unknown>[] : []
  return {
    codigo: texto(o.codigo),
    tienda: texto(o.tienda),
    equipo: texto(o.equipo),
    modelo: texto(o.modelo),
    estado: { nombre: texto(estado.nombre), descripcion: texto(estado.descripcion) },
    entrega_prevista: texto(o.entrega_prevista),
    linea_de_tiempo: linea.map((p) => ({ estado: texto(p?.estado), fecha: texto(p?.fecha) })),
  }
}

export async function manejar(req: Request, { sal, datos }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, ...seguridadHeaders } })
  if (req.method !== 'POST') return response({ error: 'metodo_no_soportado' }, 405)
  if (!sal) {
    console.error('consultar-estado-reparacion: falta SEGUIMIENTO_IP_SALT')
    return response({ error: 'error_interno' }, 500)
  }

  const ipHash = createHmac('sha256', sal).update(ipDelPedido(req)).digest('hex')
  const limite = await datos.registrarConsulta(ipHash, VENTANA_SEG, LIMITE_CONSULTAS)
  if (limite.error || !limite.data) {
    console.error('consultar-estado-reparacion: no se pudo registrar la consulta', limite.error?.message)
    return response({ error: 'error_interno' }, 500)
  }
  if (!limite.data.permitido) {
    return response({ error: 'demasiadas_consultas' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil(limite.data.reintentar_en))) })
  }

  const body = await req.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!TOKEN_VALIDO.test(token)) return response({ error: 'no_encontrada' }, 404)

  const { data, error } = await datos.estadoPublico(token)
  if (error) {
    console.error('consultar-estado-reparacion: no se pudo consultar', error.message)
    return response({ error: 'error_interno' }, 500)
  }
  if (!data) return response({ error: 'no_encontrada' }, 404)
  return response(listaBlanca(data))
}
