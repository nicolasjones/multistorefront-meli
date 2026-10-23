// Lógica de `enviar-aviso-consulta` (F-CON-03, FR-012) con dependencias inyectadas para probarla sin
// Deno, Supabase ni SMTP (handler.test.ts). `index.ts` solo cablea los clientes reales.
// No la llama el navegador: la invoca el flow de Kestra `avisos-consultas` (barrido de pendientes) o un
// operador, con el secreto compartido AVISOS_CONSULTAS_TOKEN en `x-aviso-token`. El destinatario NUNCA
// viene del pedido: lo resuelve la base (`tomar_aviso_consulta`), así la función no es un relay abierto.
// Garantía: al menos una vez. Si el correo salió pero la base no pudo cerrar el aviso, se reintenta
// pasada la reserva y puede llegar un duplicado (se prefiere eso a perder el aviso).
import { timingSafeEqual } from 'node:crypto'
import type { EnviarCorreo } from '../_shared/correo.ts'
import { asuntoAviso, cuerpoAviso, enlaceConsulta } from './contenido.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const MAX_INTENTOS = 5
export const LIMITE_BARRIDO = 50
const ERROR_MAX = 300
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type EstadoAviso = 'enviado' | 'fallido' | 'sin_destinatario' | 'ya_enviado' | 'en_proceso' | 'agotado' | 'no_existe'

export type Tomado = {
  resultado: 'enviar' | 'ya_enviado' | 'sin_destinatario' | 'agotado' | 'en_proceso' | 'no_existe'
  destinatario: string | null
  empresa_nombre: string | null
  origen: string | null
  nombre: string | null
  contacto: string | null
  mensaje: string | null
  producto_nombre: string | null
}

export type Deps = {
  /** Secreto compartido con Kestra (AVISOS_CONSULTAS_TOKEN); sin él la función rechaza todo. */
  token: string | undefined
  /** Base del panel (PANEL_URL) para armar el enlace. */
  panelUrl: string | undefined
  datos: {
    pendientes(tope: number, limite: number): Resultado<string[] | null>
    tomar(consultaId: string, tope: number): Resultado<Tomado[] | null>
    cerrar(consultaId: string, enviado: boolean, error: string | null): Resultado<unknown>
  }
  enviar: EnviarCorreo
}

const tokenValido = (esperado: string | undefined, recibido: string | null) => {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const mensajeDeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX) || 'Error de envío sin detalle'

/** Procesa el aviso de una consulta: toma, envía y cierra. Idempotente por `consulta_id`. */
export async function procesarAviso(consultaId: string, deps: Deps): Promise<EstadoAviso> {
  const { data, error } = await deps.datos.tomar(consultaId, MAX_INTENTOS)
  if (error || !data || data.length === 0) {
    throw new Error(`No se pudo tomar el aviso: ${error?.message ?? 'sin respuesta'}`)
  }
  const fila = data[0]
  if (fila.resultado !== 'enviar') return fila.resultado

  // El respaldo `dominio.empresas.correo` no pasa por la validación de la dirección de avisos.
  if (!CORREO_VALIDO.test(fila.destinatario ?? '') || (fila.destinatario ?? '').length > 254) {
    const cierre = await deps.datos.cerrar(consultaId, false, 'La dirección de avisos de la empresa no es un correo válido')
    if (cierre.error) console.error('enviar-aviso-consulta: no se pudo registrar el fallo', consultaId, cierre.error.message)
    return 'fallido'
  }

  try {
    const enlace = enlaceConsulta(deps.panelUrl as string, consultaId)
    await deps.enviar({
      para: [fila.destinatario as string],
      asunto: asuntoAviso(fila.empresa_nombre ?? ''),
      texto: cuerpoAviso({
        empresaNombre: fila.empresa_nombre ?? '',
        origen: fila.origen ?? '',
        nombre: fila.nombre ?? '',
        contacto: fila.contacto ?? '',
        mensaje: fila.mensaje,
        productoNombre: fila.producto_nombre,
      }, enlace),
    })
  } catch (falla) {
    const detalle = mensajeDeError(falla)
    console.error('enviar-aviso-consulta: falló el envío', consultaId, detalle)
    const cierre = await deps.datos.cerrar(consultaId, false, detalle)
    if (cierre.error) console.error('enviar-aviso-consulta: no se pudo registrar el fallo', consultaId, cierre.error.message)
    return 'fallido'
  }

  const cierre = await deps.datos.cerrar(consultaId, true, null)
  if (cierre.error) console.error('enviar-aviso-consulta: el correo salió pero no se pudo cerrar el aviso', consultaId, cierre.error.message)
  return 'enviado'
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  if (!deps.token) {
    console.error('enviar-aviso-consulta: falta AVISOS_CONSULTAS_TOKEN')
    return response({ error: 'La función no está configurada.' }, 503)
  }
  if (!tokenValido(deps.token, req.headers.get('x-aviso-token'))) return response({ error: 'Falta autenticación.' }, 403)
  if (!deps.panelUrl?.trim()) {
    console.error('enviar-aviso-consulta: falta PANEL_URL')
    return response({ error: 'La función no está configurada.' }, 503)
  }

  const body = await req.json().catch(() => null) as { consulta_id?: unknown; barrer?: unknown } | null

  if (body?.barrer === true) {
    const { data: ids, error } = await deps.datos.pendientes(MAX_INTENTOS, LIMITE_BARRIDO)
    if (error) {
      console.error('enviar-aviso-consulta: no se pudo listar los pendientes', error.message)
      return response({ error: 'No se pudieron leer los avisos pendientes.' }, 502)
    }
    const resultados: Partial<Record<EstadoAviso, number>> = {}
    let errores = 0
    for (const id of ids ?? []) {
      try {
        const estado = await procesarAviso(id, deps)
        resultados[estado] = (resultados[estado] ?? 0) + 1
      } catch (falla) {
        errores += 1
        console.error('enviar-aviso-consulta: aviso con error', id, mensajeDeError(falla))
      }
    }
    return response({ procesados: (ids ?? []).length, resultados, errores })
  }

  if (typeof body?.consulta_id !== 'string' || !UUID.test(body.consulta_id)) return response({ error: 'Falta la consulta.' }, 400)
  try {
    return response({ estado: await procesarAviso(body.consulta_id, deps) })
  } catch (falla) {
    console.error('enviar-aviso-consulta: error inesperado', mensajeDeError(falla))
    return response({ error: 'No se pudo procesar el aviso.' }, 502)
  }
}
