// Lógica de `preguntar-documentos` con dependencias inyectadas (probada con `pnpm test:edge:preguntar-documentos`);
// index.ts solo cablea los clientes reales de Supabase, el entorno, el tope del cupo, los embeddings y el `fetch` hacia el proveedor.
//
// Contrato: ver spec del mecanismo de búsqueda documental genérica en
// este template (sección "Contrato de búsqueda").
//
// Embebe la pregunta, busca fragmentos relevantes (solo de versiones
// activas, solo de la organización del usuario — vía RLS, nunca
// service-role) y genera una respuesta citando los documentos de origen.
// Si nada supera el umbral, responde que no encontró información sin
// llamar al proveedor de generación.
//
// Sin imports de Deno ni de `npm:`: corre con `node --test`. `prepararInvocacion` (que arrastra Ajv por `npm:`), la
// creación de clientes y los embeddings entran por `Deps`.
import type { ContratoConsumidor, PerfilModelo } from '../_shared/ia/types.ts'
import type { prepararInvocacion } from '../_shared/ia/ejecutar.ts'
import { invocarProveedorIa, type FetchInvocacion } from '../_shared/ia/proveedores/index.ts'
import { rechazoPorFuncionalidad } from '../_shared/acceso-ia.ts'
import { FUNCIONALIDAD_DOCUMENTOS, esTimeoutDeProveedor, limiteDeCupo, rechazoPorCupo } from '../_shared/cupo-ia.ts'
import { limpiarParaLog, mensajeParaLog, registrarErrorDeBase, textoDeError } from '../_shared/log-seguro.ts'
import { armarContexto } from './contexto.ts'

type Resultado = PromiseLike<{ data: any; error: any }>
type Rpc = (nombre: string, args: Record<string, unknown>) => Resultado

// Cliente con la service-role: solo valida el JWT y resuelve política/credencial (governed-ai-core).
export type ClienteAdmin = {
  auth: { getUser(jwt: string): PromiseLike<{ data: { user: { id: string } | null } | null; error: unknown }> }
  rpc: Rpc
}
// Cliente autenticado como el propio usuario (anon + su JWT): el RLS decide todo dato de negocio.
export type ClienteUsuario = { rpc: Rpc; from(tabla: string): any }

export type Deps = {
  crearAdmin: () => ClienteAdmin
  crearCliente: (jwt: string) => ClienteUsuario
  prepararInvocacion: typeof prepararInvocacion
  generarEmbedding: (texto: string, clave: string) => Promise<number[]>
  fetchProveedor: (limiteSegundos: number) => FetchInvocacion
  limiteHora: () => string | undefined
  ahora: () => number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } })
}

// Falla del proveedor o de los embeddings: el tiempo agotado es 504; el resto, 502. Ninguno filtra el detalle del proveedor.
function falloDeProveedor(error: unknown, mensaje502: string, etapa: string): Response {
  // Solo nombre y código del error (nunca su mensaje, cause ni URL: pueden traer claves).
  console.error(`preguntar-documentos: fallo ${etapa}`, textoDeError(error))
  if (esTimeoutDeProveedor(error)) return jsonResponse({ error: 'El proveedor de IA tardó demasiado en responder, probá de nuevo.' }, 504)
  return jsonResponse({ error: mensaje502 }, 502)
}

const CONSUMIDOR_CODIGO = 'rag-busqueda-documental'
const UMBRAL_SIMILITUD = 0.5
const K_FRAGMENTOS = 6
const PREGUNTA_MAX = 2000
const MAX_TOKENS_RESPUESTA = 1024

const CONTRATO: ContratoConsumidor = {
  codigo: CONSUMIDOR_CODIGO,
  version: 1,
  esquemaEntrada: { type: 'object', properties: { pregunta: { type: 'string' } }, required: ['pregunta'] },
  esquemaSalida: { type: 'object', properties: { respuesta: { type: 'string' } }, required: ['respuesta'] },
  datosPermitidos: ['pregunta', 'organizacion_id'],
  limiteIntentos: 1,
  limiteSegundos: 60,
  claveAislamientoOrganizacion: 'organizacion_id',
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no soportado, usar POST.' }, 400)

  const admin = deps.crearAdmin()
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse({ error: 'No autorizado' }, 403)

  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData?.user) return jsonResponse({ error: 'No autorizado' }, 403)

  let body: { pregunta?: unknown } | null
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }
  const pregunta = typeof body?.pregunta === 'string' ? body.pregunta : ''
  if (!pregunta.trim()) return jsonResponse({ error: 'Falta "pregunta".' }, 400)
  if (pregunta.length > PREGUNTA_MAX) return jsonResponse({ error: `La pregunta admite hasta ${PREGUNTA_MAX} caracteres.` }, 400)

  const asUser = deps.crearCliente(jwt)

  // Antes de gastar crédito (embedding y generación): la organización del usuario debe tener la funcionalidad
  // `busqueda-documental` (verificada con su propio JWT); el cupo persistente por hora se consume justo antes de llamar al proveedor.
  const featureDocs = await asUser.rpc('tiene_feature_publica', { p_feature_id: 'busqueda-documental' })
  if (featureDocs.error) console.error('preguntar-documentos: no se pudo verificar la funcionalidad', mensajeParaLog(featureDocs.error.message, 300))
  const sinDocs = rechazoPorFuncionalidad(featureDocs, { noHabilitada: 'La búsqueda documental no está habilitada para tu organización.', noVerificable: 'No se pudo verificar la funcionalidad de búsqueda documental.' })
  if (sinDocs) return jsonResponse({ error: sinDocs.error }, sinDocs.status)

  const { data: politicaFilas, error: politicaError } = await admin.rpc('resolver_politica_ia', { p_codigo: CONSUMIDOR_CODIGO })
  const politica = politicaFilas?.[0]
  if (politicaError || !politica) {
    return jsonResponse({ error: 'Búsqueda documental no está configurada todavía: falta una política aprobada para "rag-busqueda-documental". Un superadmin debe crearla en /ia/contratos y /ia/politicas.' }, 503)
  }

  let entradaSanitizada: Record<string, unknown>
  try {
    entradaSanitizada = deps.prepararInvocacion(
      CONTRATO,
      {
        id: politica.politica_id,
        contratoId: politica.contrato_id,
        perfilPrincipalId: politica.perfil_principal_id,
        estado: 'aprobada',
        limiteIntentos: politica.limite_intentos,
        limiteSegundos: politica.limite_segundos,
        perfilFallbackId: politica.perfil_fallback_id,
      },
      { pregunta },
      // 0, no 1: intentos ya consumidos antes de esta llamada (mismo bug
      // real encontrado y corregido en chat-companion-mechanism).
      0,
      new Date(deps.ahora()),
    )
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'ENTRADA_IA_INVALIDA' }, 400)
  }

  const { data: credencialFilas, error: credencialError } = await admin.rpc('obtener_clave_perfil_ia', { p_perfil_id: politica.perfil_principal_id })
  const credencial = credencialFilas?.[0]
  if (credencialError || !credencial) {
    console.error('[preguntar-documentos] configuración de la plataforma: credencial_no_disponible')
    return jsonResponse({ error: 'No se pudo resolver la credencial del proveedor de IA.' }, 500)
  }

  if (credencial.proveedor_codigo !== 'openai') {
    console.error(`[preguntar-documentos] configuración de la plataforma: proveedor_no_soportado:${limpiarParaLog(credencial.proveedor_codigo, 64)}`)
    return jsonResponse({ error: `Búsqueda documental todavía no soporta el proveedor "${credencial.proveedor_codigo}" — solo OpenAI por ahora.` }, 501)
  }

  // Cupo persistente: 30 preguntas por usuario y hora (configurable con PREGUNTAR_DOCUMENTOS_LIMITE_HORA). Se consume después de
  // todos los chequeos y antes del primer gasto de crédito (el embedding). Agotado: 429 con Retry-After, sin llamar al proveedor.
  const sinCupo = await rechazoPorCupo(admin, callerData.user.id, FUNCIONALIDAD_DOCUMENTOS, limiteDeCupo(deps.limiteHora()), {
    agotado: 'Hiciste demasiadas preguntas en poco tiempo. Probá de nuevo más tarde.',
  })
  if (sinCupo) return jsonResponse({ error: sinCupo.error }, sinCupo.status, sinCupo.retryAfter ? { 'Retry-After': String(sinCupo.retryAfter) } : {})

  let embeddingPregunta: number[]
  try {
    embeddingPregunta = await deps.generarEmbedding(String(entradaSanitizada.pregunta), credencial.clave)
  } catch (error) {
    return falloDeProveedor(error, 'No pude procesar la pregunta, probá de nuevo.', 'al generar el embedding')
  }

  const { data: fragmentos, error: busquedaError } = await asUser.rpc('buscar_fragmentos', {
    p_embedding: `[${embeddingPregunta.join(',')}]`,
    p_umbral: UMBRAL_SIMILITUD,
    p_k: K_FRAGMENTOS,
  })
  if (busquedaError) {
    registrarErrorDeBase('preguntar-documentos: no se pudo buscar en los documentos', busquedaError)
    return jsonResponse({ error: 'No pude buscar en los documentos.' }, 500)
  }

  // Sin fragmentos por encima del umbral, no se llama al proveedor de
  // generación — se responde directo que no hay información.
  if (!fragmentos || fragmentos.length === 0) {
    return jsonResponse({ respuesta: 'No encontré información relevante en los documentos para responder eso.', documentos_citados: [] }, 200)
  }

  const { data: versionesPorFragmento } = await asUser
    .from('versiones_documento')
    .select('id, documento_id')
    .in('id', [...new Set(fragmentos.map((f: { version_id: string }) => f.version_id))])

  const documentoPorVersion = new Map((versionesPorFragmento ?? []).map((v: { id: string; documento_id: string }) => [v.id, v.documento_id]))
  const documentosCitados = [...new Set(fragmentos.map((f: { version_id: string }) => documentoPorVersion.get(f.version_id)).filter(Boolean))] as string[]

  // Si ningún fragmento trae texto no se llama al proveedor de generación (MSF-725).
  const contexto = armarContexto(fragmentos)
  if (!contexto) {
    return jsonResponse({ respuesta: 'No encontré información relevante en los documentos para responder eso.', documentos_citados: [] }, 200)
  }

  const perfil: PerfilModelo = { id: politica.perfil_principal_id, proveedorCodigo: credencial.proveedor_codigo, modeloId: credencial.modelo_id }

  let textoFinal: string
  try {
    const respuesta = await invocarProveedorIa(
      perfil,
      credencial.clave,
      {
        model: perfil.modeloId,
        max_tokens: MAX_TOKENS_RESPUESTA,
        messages: [
          { role: 'system', content: 'Respondé la pregunta del usuario usando únicamente el contexto provisto. Si el contexto no alcanza, decí que no encontraste la información.' },
          { role: 'user', content: `Contexto:\n${contexto}\n\nPregunta: ${entradaSanitizada.pregunta}` },
        ],
      },
      deps.fetchProveedor(Math.min(Number(politica.limite_segundos) || CONTRATO.limiteSegundos, 90)),
    ) as { choices: Array<{ message: { content: string } }> }
    textoFinal = respuesta.choices?.[0]?.message?.content ?? 'No pude generar una respuesta.'
  } catch (error) {
    return falloDeProveedor(error, 'No pude obtener una respuesta del proveedor de IA, probá de nuevo.', 'al invocar el proveedor')
  }

  return jsonResponse({ respuesta: textoFinal, documentos_citados: documentosCitados }, 200)
}
