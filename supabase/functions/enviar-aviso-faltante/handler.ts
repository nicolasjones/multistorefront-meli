// Lógica de `enviar-aviso-faltante` (F-STK-17, FR-308) con dependencias inyectadas para probarla sin
// Deno, Supabase ni SMTP (handler.test.ts). `index.ts` solo cablea los clientes reales.
// No la llama el navegador: la invoca el flow de Kestra `avisos-faltantes` (barrido) o un operador, con el
// secreto compartido AVISOS_FALTANTES_TOKEN en `x-aviso-token`. El destinatario NUNCA viene del pedido:
// lo resuelve la base (`tomar_aviso_faltante`), así la función no es un relay abierto.
// Un correo por cliente con todos sus faltantes. Garantía: al menos una vez. Si el correo salió pero la
// base no pudo cerrar el aviso, se reintenta pasada la reserva y puede llegar un duplicado (se prefiere
// eso a perder el aviso). Un fallo de envío nunca toca la venta ni el stock.
import { timingSafeEqual } from 'node:crypto'
import type { EnviarCorreo } from '../_shared/correo.ts'
import { asuntoAviso, cuerpoAviso, type LineaFaltante } from './contenido.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const MAX_INTENTOS = 5
export const LIMITE_BARRIDO = 50
const ERROR_MAX = 300
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type EstadoAviso = 'enviado' | 'fallido' | 'nada'

export type Tomado = { cliente: string | null; correo: string | null; lineas: LineaFaltante[] | null }

export type Deps = {
  /** Secreto compartido con Kestra (AVISOS_FALTANTES_TOKEN); sin él la función rechaza todo. */
  token: string | undefined
  datos: {
    pendientes(tope: number, limite: number): Resultado<string[] | null>
    tomar(clienteId: string, tope: number): Resultado<Tomado[] | null>
    cerrar(clienteId: string, enviado: boolean, error: string | null, tope: number): Resultado<unknown>
  }
  enviar: EnviarCorreo
}

const tokenValido = (esperado: string | undefined, recibido: string | null) => {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

// El error del SMTP puede traer la dirección del destinatario (p. ej. «550 5.1.1 <ana@example.com>»).
// Se sanean las direcciones antes de guardarlo o de escribirlo en el log: `ultimo_error` lo lee el panel
// (cualquiera con `ventas` en la tienda) y un correo del cliente no es un dato que deba quedar ahí.
const CORREO_EN_ERROR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const mensajeDeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(CORREO_EN_ERROR, '[correo]')
    .replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX) || 'Error de envío sin detalle'

/** Procesa los avisos de un cliente: toma, envía un correo y cierra. Idempotente por cliente. */
export async function procesarCliente(clienteId: string, deps: Deps): Promise<EstadoAviso> {
  const { data, error } = await deps.datos.tomar(clienteId, MAX_INTENTOS)
  if (error || !data) throw new Error(`No se pudo tomar el aviso: ${error?.message ?? 'sin respuesta'}`)
  // Sin filas: otra invocación lo tiene reservado, ya se envió o no quedó nada vigente.
  if (data.length === 0 || !data[0].lineas?.length) return 'nada'
  const fila = data[0]

  const cerrarFallido = async (detalle: string) => {
    const cierre = await deps.datos.cerrar(clienteId, false, detalle, MAX_INTENTOS)
    if (cierre.error) console.error('enviar-aviso-faltante: no se pudo registrar el fallo', clienteId, cierre.error.message)
    return 'fallido' as const
  }

  // El correo del cliente lo carga una persona: se valida antes de usarlo como destinatario.
  if (!CORREO_VALIDO.test(fila.correo ?? '') || (fila.correo ?? '').length > 254) {
    return cerrarFallido('El correo del cliente no es una dirección válida')
  }

  try {
    await deps.enviar({
      para: [fila.correo as string],
      asunto: asuntoAviso(),
      texto: cuerpoAviso(fila.cliente ?? '', fila.lineas),
    })
  } catch (falla) {
    const detalle = mensajeDeError(falla)
    console.error('enviar-aviso-faltante: falló el envío', clienteId, detalle)
    return cerrarFallido(detalle)
  }

  const cierre = await deps.datos.cerrar(clienteId, true, null, MAX_INTENTOS)
  if (cierre.error) console.error('enviar-aviso-faltante: el correo salió pero no se pudo cerrar el aviso', clienteId, cierre.error.message)
  return 'enviado'
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  if (!deps.token) {
    console.error('enviar-aviso-faltante: falta AVISOS_FALTANTES_TOKEN')
    return response({ error: 'La función no está configurada.' }, 503)
  }
  if (!tokenValido(deps.token, req.headers.get('x-aviso-token'))) return response({ error: 'Falta autenticación.' }, 403)

  const body = await req.json().catch(() => null) as { cliente_id?: unknown; barrer?: unknown } | null

  if (body?.barrer === true) {
    const { data: ids, error } = await deps.datos.pendientes(MAX_INTENTOS, LIMITE_BARRIDO)
    if (error) {
      console.error('enviar-aviso-faltante: no se pudo listar los pendientes', error.message)
      return response({ error: 'No se pudieron leer los avisos pendientes.' }, 502)
    }
    const resultados: Partial<Record<EstadoAviso, number>> = {}
    let errores = 0
    for (const id of ids ?? []) {
      try {
        const estado = await procesarCliente(id, deps)
        resultados[estado] = (resultados[estado] ?? 0) + 1
      } catch (falla) {
        errores += 1
        console.error('enviar-aviso-faltante: aviso con error', id, mensajeDeError(falla))
      }
    }
    return response({ procesados: (ids ?? []).length, resultados, errores })
  }

  if (typeof body?.cliente_id !== 'string' || !UUID.test(body.cliente_id)) return response({ error: 'Falta el cliente.' }, 400)
  try {
    return response({ estado: await procesarCliente(body.cliente_id, deps) })
  } catch (falla) {
    console.error('enviar-aviso-faltante: error inesperado', mensajeDeError(falla))
    return response({ error: 'No se pudo procesar el aviso.' }, 502)
  }
}
