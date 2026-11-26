import type { PerfilModelo } from '../types.ts'
import { endpointInvocacion, proveedorDelCatalogo, type AdaptadorProveedor } from './catalogo.ts'

export type ModeloDescubierto = {
  modeloId: string
  capacidades: Record<string, unknown>
}

export type RespuestaHttp = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type FetchModelos = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<RespuestaHttp>

// Tope de espera opcional: con `timeoutMs` cada `fetch` lleva `AbortSignal.timeout` y un proveedor colgado falla con un error de
// negocio (`..._TIMEOUT`, sin detalle del proveedor) en vez de ocupar el proceso hasta el límite de la plataforma.
export type OpcionesTransporte = { timeoutMs?: number }

function esAbortoPorTiempo(error: unknown): boolean {
  let nombre: unknown
  try { nombre = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined } catch { nombre = undefined }
  return nombre === 'TimeoutError' || nombre === 'AbortError'
}

function senal(opciones?: OpcionesTransporte): { signal: AbortSignal } | Record<string, never> {
  const ms = opciones?.timeoutMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? { signal: AbortSignal.timeout(ms) } : {}
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESPUESTA_MODELOS_IA_INVALIDA')
  return value as Record<string, unknown>
}

function lista(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor)) throw new Error('RESPUESTA_MODELOS_IA_INVALIDA')
  return valor.map(asRecord)
}

function normalizar(adaptador: AdaptadorProveedor, cuerpo: unknown): ModeloDescubierto[] {
  const data = asRecord(cuerpo)
  const items = adaptador === 'gemini' ? lista(data.models) : lista(data.data ?? data.models)
  return items.map((item) => {
    const bruto = typeof item.id === 'string' ? item.id : item.name
    if (typeof bruto !== 'string' || bruto.length === 0) throw new Error('RESPUESTA_MODELOS_IA_INVALIDA')
    const modeloId = adaptador === 'gemini' ? bruto.replace(/^models\//, '') : bruto
    const capacidades = adaptador === 'gemini'
      ? { acciones: Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [] }
      : {}
    return { modeloId, capacidades }
  })
}

// Content-Type explícito en los tres casos: descubrirModelos (GET, sin
// body) nunca lo necesitó y el gap pasó desapercibido hasta que
// invocarProveedorIa (POST con body JSON) lo probó en vivo por primera vez
// — sin este header, OpenAI responde 400 "you must provide a model
// parameter" aunque el body sí lo traiga, porque nunca lo parsea como JSON.
function encabezados(adaptador: AdaptadorProveedor, clave: string): Record<string, string> {
  if (adaptador === 'anthropic') return { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
  if (adaptador === 'gemini') return { 'x-goog-api-key': clave, 'Content-Type': 'application/json' }
  return { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' }
}

export async function descubrirModelos(
  codigoProveedor: string,
  clave: string,
  fetchModelos: FetchModelos,
  opciones?: OpcionesTransporte,
): Promise<ModeloDescubierto[]> {
  const proveedor = proveedorDelCatalogo(codigoProveedor)
  let response: RespuestaHttp
  let cuerpo: unknown
  try {
    response = await fetchModelos(proveedor.endpointModelos, { headers: encabezados(proveedor.adaptador, clave), ...senal(opciones) })
    if (!response.ok) throw new Error(`DESCUBRIMIENTO_MODELOS_IA_FALLO_${response.status}`)
    cuerpo = await response.json()
  } catch (error) {
    if (esAbortoPorTiempo(error)) throw new Error('DESCUBRIMIENTO_MODELOS_IA_TIMEOUT')
    throw error
  }
  return normalizar(proveedor.adaptador, cuerpo)
}

export type FetchInvocacion = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<RespuestaHttp>

// Transporte puro: no interpreta ni valida el cuerpo de la petición ni de la
// respuesta — eso queda a cargo del consumidor, cada proveedor espera y
// devuelve una forma distinta y packages/ia no se acopla a ninguna.
export async function invocarProveedorIa(
  perfil: PerfilModelo,
  clave: string,
  cuerpo: unknown,
  fetchInvocacion: FetchInvocacion,
  opciones?: OpcionesTransporte,
): Promise<unknown> {
  const proveedor = proveedorDelCatalogo(perfil.proveedorCodigo)
  const url = endpointInvocacion(proveedor, perfil.modeloId)
  try {
    const response = await fetchInvocacion(url, {
      method: 'POST',
      headers: encabezados(proveedor.adaptador, clave),
      body: JSON.stringify(cuerpo),
      ...senal(opciones),
    })
    if (!response.ok) throw new Error(`INVOCACION_PROVEEDOR_IA_FALLO_${response.status}`)
    return await response.json()
  } catch (error) {
    // El tiempo agotado (también leyendo el cuerpo) se informa como error de negocio, sin el detalle del proveedor.
    if (esAbortoPorTiempo(error)) throw new Error('INVOCACION_PROVEEDOR_IA_TIMEOUT')
    throw error
  }
}
