// Lógica de `cotizacion-sugerida` (F-PRE-13, MSF-373) con dependencias inyectadas para probarla sin Deno ni
// Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
// Devuelve el dólar OFICIAL (precio de venta) de una fuente pública para SUGERIRLO en el diálogo «Cargar dólar
// del día». No guarda nada ni cambia precios: la carga y la confirmación siguen siendo las de MSF-116.
// Seguridad: la URL de la fuente es una constante (el navegador no manda nada que llegue a la consulta, así no
// hay SSRF); exige sesión y nivel `edicion` en `cotizacion_dolar` (quien puede cargar el dólar), con tiempo
// máximo y validación estricta de la respuesta; sin service-role y sin secretos.

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const FUENTE_URL = 'https://dolarapi.com/v1/dolares/oficial'
export const FUENTE_NOMBRE = 'DolarApi (dólar oficial, venta)'
export const TIEMPO_MAXIMO_MS = 5000
// Cota de cordura: un valor fuera de rango es un dato roto de la fuente, no una cotización para sugerir.
export const VALOR_MAXIMO = 1_000_000

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type Deps = {
  getUser(jwt: string): Resultado<{ user: { id: string } | null }>
  // Cliente con la sesión de quien llama: `permisos_actuales()` resuelve por su usuario.
  caller(jwt: string): { nivelCotizacion(): Resultado<string | null> }
  // `fetch` con la URL y el tiempo máximo ya fijados; devuelve el JSON de la fuente o lanza.
  leerFuente(): Promise<unknown>
}

export type Sugerencia = { valor: number; fuente: string; fecha: string | null }

// Acepta solo `{ venta: número finito > 0 y < VALOR_MAXIMO, fechaActualizacion?: texto ISO }`.
export function leerSugerencia(cuerpo: unknown): Sugerencia | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const { venta, fechaActualizacion } = cuerpo as { venta?: unknown; fechaActualizacion?: unknown }
  if (typeof venta !== 'number' || !Number.isFinite(venta) || venta >= VALOR_MAXIMO) return null
  const valor = Math.round(venta * 100) / 100
  if (valor <= 0) return null
  const fecha = typeof fechaActualizacion === 'string' && !Number.isNaN(Date.parse(fechaActualizacion)) ? new Date(fechaActualizacion).toISOString() : null
  return { valor, fuente: FUENTE_NOMBRE, fecha }
}

export async function manejar(req: Request, { getUser, caller, leerFuente }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const { data: sesion, error: sesionError } = await getUser(jwt)
  if (sesionError || !sesion.user) return response({ error: 'Token inválido o expirado.' }, 403)

  const { data: nivel, error: nivelError } = await caller(jwt).nivelCotizacion()
  if (nivelError) {
    console.error('cotizacion-sugerida: no se pudo resolver el permiso', nivelError.message)
    return response({ error: 'No se pudo verificar tu permiso.' }, 502)
  }
  if (nivel !== 'edicion') return response({ error: 'No tienes permiso para cargar la cotización.' }, 403)

  let cuerpo: unknown
  try {
    cuerpo = await leerFuente()
  } catch (error) {
    console.error('cotizacion-sugerida: la fuente no respondió', error instanceof Error ? error.message : error)
    return response({ error: 'No pudimos consultar la cotización sugerida. Podés cargar el valor a mano.' }, 502)
  }
  const sugerencia = leerSugerencia(cuerpo)
  if (!sugerencia) {
    console.error('cotizacion-sugerida: respuesta de la fuente inválida')
    return response({ error: 'La fuente devolvió un valor que no se puede usar. Podés cargar el valor a mano.' }, 502)
  }
  return response(sugerencia)
}
