// Lógica de `recalcular-alertas-inicio` (F-INI-02, FR-022) con dependencias inyectadas para probarla sin
// Deno ni Supabase (handler.test.ts). `index.ts` solo cablea el cliente real.
// No la llama el navegador: la invoca el flow de Kestra `alertas-inicio` (cada 15 minutos) o un operador, con
// el secreto compartido ALERTAS_INICIO_TOKEN en `x-aviso-token`. La función solo dispara el recálculo de la
// base (`recalcular_alertas_inicio`), que es idempotente: reintentar es seguro. El registro de cada ejecución
// por organización (fecha y cantidad) lo guarda la base en dominio.alertas_inicio_calculos; acá se devuelve el
// resumen y los errores quedan en los registros de la función sin datos de negocio.
import { timingSafeEqual } from 'node:crypto'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const ERROR_MAX = 300

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type Calculo = { alertas: number; calculada_en: string }

export type Deps = {
  /** Secreto compartido con Kestra (ALERTAS_INICIO_TOKEN); sin él la función rechaza todo. */
  token: string | undefined
  datos: {
    organizaciones(): Resultado<string[] | null>
    recalcular(organizacion: string): Resultado<Calculo | null>
  }
}

const tokenValido = (esperado: string | undefined, recibido: string | null) => {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

const mensajeDeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX) || 'Error sin detalle'

/** Recalcula las alertas de una organización y devuelve el cálculo registrado. */
export async function procesarOrganizacion(organizacion: string, deps: Deps): Promise<Calculo> {
  const { data, error } = await deps.datos.recalcular(organizacion)
  if (error) throw new Error(`No se pudo recalcular las alertas: ${error.message}`)
  if (!data) throw new Error('El recálculo no devolvió resultado')
  return data
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  if (!deps.token) {
    console.error('recalcular-alertas-inicio: falta ALERTAS_INICIO_TOKEN')
    return response({ error: 'La función no está configurada.' }, 503)
  }
  if (!tokenValido(deps.token, req.headers.get('x-aviso-token'))) return response({ error: 'Falta autenticación.' }, 403)

  const body = await req.json().catch(() => null) as { barrer?: unknown } | null
  if (body?.barrer !== true) return response({ error: 'Pedido inválido: se espera {"barrer": true}.' }, 400)

  const { data: ids, error } = await deps.datos.organizaciones()
  if (error) {
    console.error('recalcular-alertas-inicio: no se pudo listar las organizaciones', error.message)
    return response({ error: 'No se pudieron leer las organizaciones.' }, 502)
  }

  let calculadas = 0
  let alertas = 0
  let errores = 0
  // Una organización con error no frena a las demás: se sigue y se responde 502 para que Kestra reintente.
  for (const id of ids ?? []) {
    try {
      const calculo = await procesarOrganizacion(id, deps)
      calculadas += 1
      alertas += calculo.alertas
    } catch (falla) {
      errores += 1
      console.error('recalcular-alertas-inicio: organización con error', id, mensajeDeError(falla))
    }
  }
  return response({ organizaciones: (ids ?? []).length, calculadas, alertas, errores }, errores > 0 ? 502 : 200)
}
