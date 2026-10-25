// Lógica de `enviar-resumen-reposicion` (F-STK-09, FR-203…FR-206) con dependencias inyectadas para
// probarla sin Deno, Supabase ni SMTP (handler.test.ts). `index.ts` solo cablea los clientes reales.
// No la llama el navegador: la invoca el flow de Kestra `avisos-reposicion-stock` (barrido diario) o un
// operador, con el secreto compartido AVISOS_REPOSICION_TOKEN en `x-aviso-token`. Los destinatarios
// NUNCA vienen del pedido: los resuelve la base (`generar_resumen_reposicion`), así la función no es un
// relay abierto. Garantía: al menos una vez. Si el correo salió pero la base no pudo cerrar el resumen,
// los productos siguen sin marca y el próximo barrido los vuelve a avisar (se prefiere un duplicado a
// perder el aviso).
import { timingSafeEqual } from 'node:crypto'
import type { EnviarCorreo } from '../_shared/correo.ts'
import { asuntoResumen, cuerpoResumen, enlaceStock, type ProductoResumen } from './contenido.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const MAX_INTENTOS = 5
const ERROR_MAX = 300
// A la tabla (legible por quien tiene Stock en lectura) solo va un texto genérico; el detalle SMTP queda en los registros.
const ERROR_ENVIO_GENERICO = 'Falló el envío del correo; el detalle está en los registros de la función'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type EstadoResumen = 'enviado' | 'fallido' | 'sin_destinatario' | 'sin_novedades'

export type Generado = {
  resumen_id: string
  sin_stock: number
  stock_bajo: number
  productos: ProductoResumen[]
  destinatarios: string[]
}

export type Deps = {
  /** Secreto compartido con Kestra (AVISOS_REPOSICION_TOKEN); sin él la función rechaza todo. */
  token: string | undefined
  /** Base del panel (PANEL_URL) para armar el enlace. */
  panelUrl: string | undefined
  datos: {
    organizaciones(): Resultado<string[] | null>
    generar(organizacion: string, tope: number): Resultado<Generado[] | null>
    cerrar(resumen: string, enviado: boolean, error: string | null): Resultado<unknown>
  }
  enviar: EnviarCorreo
}

const tokenValido = (esperado: string | undefined, recibido: string | null) => {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

const mensajeDeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX) || 'Error de envío sin detalle'

async function cerrar(deps: Deps, resumen: string, enviado: boolean, error: string | null) {
  const cierre = await deps.datos.cerrar(resumen, enviado, error)
  if (cierre.error) {
    console.error(
      enviado
        ? 'enviar-resumen-reposicion: el correo salió pero no se pudo cerrar el resumen'
        : 'enviar-resumen-reposicion: no se pudo registrar el fallo',
      resumen,
      cierre.error.message,
    )
  }
}

/** Procesa el resumen de una organización: genera, envía y cierra. */
export async function procesarOrganizacion(organizacion: string, deps: Deps): Promise<EstadoResumen> {
  const { data, error } = await deps.datos.generar(organizacion, MAX_INTENTOS)
  if (error) throw new Error(`No se pudo generar el resumen: ${error.message}`)
  const fila = data?.[0]
  if (!fila) return 'sin_novedades'

  // FR-204: sin destinatarios la base ya lo registró como «sin destinatario» y no marcó productos.
  const todos = fila.destinatarios ?? []
  if (todos.length === 0) return 'sin_destinatario'
  const destinatarios = todos.filter((c) => CORREO_VALIDO.test(c) && c.length <= 254)
  if (destinatarios.length === 0) {
    await cerrar(deps, fila.resumen_id, false, 'Ninguna dirección de destino es un correo válido')
    return 'fallido'
  }

  try {
    await deps.enviar({
      para: destinatarios,
      asunto: asuntoResumen(fila.sin_stock, fila.stock_bajo),
      texto: cuerpoResumen(fila.productos, enlaceStock(deps.panelUrl as string)),
    })
  } catch (falla) {
    const detalle = mensajeDeError(falla)
    console.error('enviar-resumen-reposicion: falló el envío', fila.resumen_id, detalle)
    await cerrar(deps, fila.resumen_id, false, ERROR_ENVIO_GENERICO)
    return 'fallido'
  }

  await cerrar(deps, fila.resumen_id, true, null)
  return 'enviado'
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  if (!deps.token) {
    console.error('enviar-resumen-reposicion: falta AVISOS_REPOSICION_TOKEN')
    return response({ error: 'La función no está configurada.' }, 503)
  }
  if (!tokenValido(deps.token, req.headers.get('x-aviso-token'))) return response({ error: 'Falta autenticación.' }, 403)
  if (!deps.panelUrl?.trim()) {
    console.error('enviar-resumen-reposicion: falta PANEL_URL')
    return response({ error: 'La función no está configurada.' }, 503)
  }

  const body = await req.json().catch(() => null) as { organizacion_id?: unknown; barrer?: unknown } | null

  if (body?.barrer === true) {
    const { data: ids, error } = await deps.datos.organizaciones()
    if (error) {
      console.error('enviar-resumen-reposicion: no se pudo listar las organizaciones', error.message)
      return response({ error: 'No se pudieron leer los resúmenes pendientes.' }, 502)
    }
    const resultados: Partial<Record<EstadoResumen, number>> = {}
    let errores = 0
    for (const id of ids ?? []) {
      try {
        const estado = await procesarOrganizacion(id, deps)
        resultados[estado] = (resultados[estado] ?? 0) + 1
      } catch (falla) {
        errores += 1
        console.error('enviar-resumen-reposicion: organización con error', id, mensajeDeError(falla))
      }
    }
    // Con errores o resúmenes fallidos responde 502 para que Kestra marque la ejecución (y reintente).
    const huboFallas = errores > 0 || (resultados.fallido ?? 0) > 0
    return response({ procesadas: (ids ?? []).length, resultados, errores }, huboFallas ? 502 : 200)
  }

  if (typeof body?.organizacion_id !== 'string' || !UUID.test(body.organizacion_id)) return response({ error: 'Falta la organización.' }, 400)
  try {
    return response({ estado: await procesarOrganizacion(body.organizacion_id, deps) })
  } catch (falla) {
    console.error('enviar-resumen-reposicion: error inesperado', mensajeDeError(falla))
    return response({ error: 'No se pudo procesar el resumen.' }, 502)
  }
}
