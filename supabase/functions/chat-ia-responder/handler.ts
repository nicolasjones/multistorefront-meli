// Lógica de `chat-ia-responder` con dependencias inyectadas (probada con `pnpm test:edge:chat-ia-responder`); index.ts
// solo cablea los clientes reales de Supabase, las variables de entorno y el `fetch` hacia el proveedor.
//
// Recibe un mensaje de usuario, resuelve la política aprobada del
// consumidor 'chat-ia-leer' (gobernanza real: si no hay una política
// `aprobada` con su contrato `aprobado`, falla cerrado con un error claro
// — no inventa ni aprueba nada, eso es un gate humano vía /ia/politicas).
// Ejecuta un ciclo de tool-calling — Anthropic (Messages API) u OpenAI
// (Chat Completions API), según el adaptador de la política aprobada;
// cualquier otro adaptador falla con un error claro (501), nunca asume un
// formato no verificado. Si el modelo pide la herramienta `leer`, se
// resuelve contra fuentes_chat_ia/capacidades_chat_ia con la sesión del
// propio usuario (nunca service-role) antes de ejecutar cualquier
// consulta — el aislamiento de organización vive en esa consulta (RLS),
// no en el prompt.
//
// Sin imports de Deno ni de `npm:`: corre con `node --test`. `prepararInvocacion` (que arrastra Ajv por `npm:`) y la
// creación de clientes entran por `Deps`.
import { acotarFilas, TOPE_FILAS_CONSULTA } from './limites.ts'
import type { ContratoConsumidor, PerfilModelo } from '../_shared/ia/types.ts'
import type { prepararInvocacion } from '../_shared/ia/ejecutar.ts'
import { invocarProveedorIa, type FetchInvocacion } from '../_shared/ia/proveedores/index.ts'
import { sanitizarDato, marcarContenidoNoConfiable } from '../_shared/ia/sanitizar.ts'
import { rechazoPorFuncionalidad } from '../_shared/acceso-ia.ts'
import { FUNCIONALIDAD_CHAT, esTimeoutDeProveedor, limiteDeCupo, rechazoPorCupo } from '../_shared/cupo-ia.ts'
import { limpiarParaLog, mensajeParaLog, registrarErrorDeBase, textoDeError } from '../_shared/log-seguro.ts'
import {
  ErrorPersistencia, MAX_TOKENS_RESPUESTA, columnasParaSelect, describirPropuesta, filtrosSeguros, guardarMensaje,
  resolverLlamadas, validarEntrada, type ResultadoHerramienta,
} from './guardas.ts'

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
  fetchProveedor: (limiteSegundos: number) => FetchInvocacion
  ahora: () => number
  limiteHora: () => string | undefined
  systemPrompt: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  })
}

// Falla del proveedor: el tiempo agotado se informa como 504 (la política de `limiteSegundos` se cumple de verdad); el resto, 502.
// Ninguno de los dos filtra el detalle del proveedor.
function falloDeProveedor(error: unknown): { mensaje: string; status: number } {
  if (esTimeoutDeProveedor(error)) return { mensaje: 'El proveedor de IA tardó demasiado en responder, probá de nuevo.', status: 504 }
  return { mensaje: 'No pude obtener una respuesta del proveedor de IA, probá de nuevo.', status: 502 }
}

const CONSUMIDOR_CODIGO = 'chat-ia-leer'

// Códigos de `prepararInvocacion` que indican una política o un perfil mal configurados (plataforma), no un error del cliente: solo
// esos dejan log de servidor. Los demás (entrada fuera de esquema, organización no autorizada…) son del cliente y no se registran.
const CODIGOS_DE_CONFIGURACION = new Set(['POLITICA_IA_INACTIVA', 'LIMITE_INTENTOS_IA_INVALIDO', 'LIMITE_TIEMPO_IA_INVALIDO', 'LIMITE_INTENTOS_IA'])

// Log de servidor para los rechazos 400/500/501 de configuración (ya no dejan un mensaje `fallida`): prefijo estable y solo el motivo,
// nunca la clave, el contenido del mensaje ni datos del usuario. El `motivo` es un texto fijo más piezas que ya llegan saneadas y acotadas
// a 64 caracteres con `limpiarParaLog` (adaptador) o salen de la lista fija CODIGOS_DE_CONFIGURACION (código de política), por eso no necesita un tope propio.
const registrarConfiguracion = (motivo: string) => console.error(`[chat-ia-responder] configuración de la plataforma: ${motivo}`)

const CONTRATO: ContratoConsumidor = {
  codigo: CONSUMIDOR_CODIGO,
  version: 1,
  esquemaEntrada: { type: 'object', properties: { mensaje: { type: 'string' } }, required: ['mensaje'] },
  esquemaSalida: { type: 'object', properties: { respuesta: { type: 'string' } }, required: ['respuesta'] },
  datosPermitidos: ['mensaje', 'organizacion_id'],
  limiteIntentos: 1,
  limiteSegundos: 60,
  claveAislamientoOrganizacion: 'organizacion_id',
}

const HERRAMIENTA_LEER = {
  name: 'leer',
  description: 'Lee datos de una funcionalidad habilitada de la organización del usuario.',
  input_schema: {
    type: 'object',
    properties: {
      vista: { type: 'string', description: 'Nombre de la vista registrada a consultar.' },
      filtros: { type: 'object', description: 'Pares clave/valor para filtrar la consulta.' },
    },
    required: ['vista'],
  },
}

const HERRAMIENTA_EJECUTAR = {
  name: 'ejecutar',
  description: 'Propone ejecutar una acción sobre una funcionalidad ejecutable de la organización. NO la ejecuta todavía — queda pendiente de confirmación explícita del usuario en la UI.',
  input_schema: {
    type: 'object',
    properties: {
      rpc: { type: 'string', description: 'Nombre de la acción registrada a ejecutar.' },
      parametros: { type: 'object', description: 'Parámetros con nombre para la acción.' },
      descripcion: { type: 'string', description: 'Descripción breve, en lenguaje natural, de qué se va a ejecutar — se le muestra al usuario para confirmar.' },
    },
    required: ['rpc', 'descripcion'],
  },
}

type BloqueAnthropic =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

// Mismo par de herramientas, formato de tool distinto por API — Anthropic
// (Messages API) usa name/description/input_schema planos; OpenAI (Chat
// Completions API) envuelve eso en {type:'function', function:{...,
// parameters}}. Derivar la forma de OpenAI de la misma fuente evita
// mantener dos definiciones del esquema por separado.
function herramientaOpenAI(h: { name: string; description: string; input_schema: unknown }) {
  return { type: 'function' as const, function: { name: h.name, description: h.description, parameters: h.input_schema } }
}

type ToolCallOpenAI = { id: string; type: 'function'; function: { name: string; arguments: string } }
type MensajeOpenAI =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCallOpenAI[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no soportado, usar POST.' }, 400)

  const admin = deps.crearAdmin()
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse({ error: 'No autorizado' }, 403)

  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData?.user) return jsonResponse({ error: 'No autorizado' }, 403)

  let cuerpoCrudo: unknown
  try {
    cuerpoCrudo = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }
  const validacion = validarEntrada(cuerpoCrudo)
  if (!validacion.ok) return jsonResponse({ error: validacion.error }, 400)
  const body = { mensaje: validacion.entrada.mensaje, conversacion_id: validacion.entrada.conversacionId }

  // Nunca service-role para datos de negocio — toda lectura/escritura corre
  // con el RLS del propio usuario.
  const asUser = deps.crearCliente(jwt)

  // Antes de gastar crédito del proveedor: la organización del usuario debe tener la funcionalidad `chat-ia` (con su propio JWT,
  // no con service-role), la conversación indicada debe existir y ser del usuario, y recién entonces se consume un uso del cupo
  // persistente por hora (`consumir_cupo_ia`): una petición inválida no gasta cupo.
  const featureChat = await asUser.rpc('tiene_feature_publica', { p_feature_id: 'chat-ia' })
  if (featureChat.error) console.error('chat-ia-responder: no se pudo verificar la funcionalidad', mensajeParaLog(featureChat.error.message, 300))
  const sinChat = rechazoPorFuncionalidad(featureChat, { noHabilitada: 'El Chat IA no está habilitado para tu organización.', noVerificable: 'No se pudo verificar la funcionalidad del chat.' })
  if (sinChat) return jsonResponse({ error: sinChat.error }, sinChat.status)

  // Una conversación inexistente o ajena (la RLS no devuelve la fila) se rechaza antes de consumir cupo y de llamar al proveedor.
  let conversacionId = body.conversacion_id
  if (conversacionId) {
    const { data: existente, error: existenteError } = await asUser.from('conversaciones_chat_ia').select('id').eq('id', conversacionId).maybeSingle()
    if (existenteError) return jsonResponse({ error: 'No se pudo verificar la conversación.' }, 503)
    if (!existente) return jsonResponse({ error: 'La conversación no existe.' }, 404)
  }

  // Gobernanza real, vía las funciones ya existentes de governed-ai-core
  // (private.resolver_politica_ia / obtener_clave_perfil_ia) — otorgadas
  // acá a service_role (ver comentario en la migración de esta spec):
  // el chat companion es una funcionalidad centralizada, no un worker de
  // cliente, así que usa el mismo nivel de confianza que cualquier Edge
  // Function de este proyecto, nunca el del navegador.
  const { data: politicaFilas, error: politicaError } = await admin.rpc('resolver_politica_ia', { p_codigo: CONSUMIDOR_CODIGO })
  const politica = politicaFilas?.[0]
  if (politicaError || !politica) {
    return jsonResponse(
      { error: 'El chat no está configurado todavía: falta una política aprobada para "chat-ia-leer". Un superadmin debe crearla en /ia/contratos y /ia/politicas.' },
      503,
    )
  }

  // Rechazos de configuración o de entrada (400/500/501): ocurren ANTES de consumir cupo y de escribir nada, así que no queman un uso
  // ni dejan conversaciones o mensajes. Si el cliente mandó una conversacion_id (ya verificada) se devuelve en el cuerpo.
  const rechazoDeConfiguracion = (mensaje: string, status: number) =>
    jsonResponse(conversacionId ? { conversacion_id: conversacionId, error: mensaje } : { error: mensaje }, status)

  // prepararInvocacion valida presupuesto/esquema/aislamiento y sanitiza
  // antes de que nada salga hacia el proveedor — mismo camino que
  // cualquier otro consumidor de packages/ia, sin reimplementar esa lógica.
  let entradaSanitizada: Record<string, unknown>
  try {
    entradaSanitizada = deps.prepararInvocacion(
      CONTRATO,
      {
        // id/contratoId/perfilPrincipalId: validarPoliticaActiva los
        // exige (sin ellos trata la política como inactiva, no solo
        // mirando el estado).
        id: politica.politica_id,
        contratoId: politica.contrato_id,
        perfilPrincipalId: politica.perfil_principal_id,
        estado: 'aprobada',
        limiteIntentos: politica.limite_intentos,
        limiteSegundos: politica.limite_segundos,
        perfilFallbackId: politica.perfil_fallback_id,
      },
      { mensaje: body.mensaje },
      // 0, no 1: intentos ya consumidos antes de esta llamada (ver
      // packages/ia-navegacion/src/intentarRecuperarPaso.ts, el único otro
      // consumidor real — interaccion.intentos arranca en 0). Con 1 acá,
      // 1 >= limiteIntentos(1) siempre tira LIMITE_INTENTOS_IA.
      0,
      new Date(deps.ahora()),
    )
  } catch (error) {
    const codigo = error instanceof Error ? error.message : 'ENTRADA_IA_INVALIDA'
    if (CODIGOS_DE_CONFIGURACION.has(codigo)) registrarConfiguracion(`politica_invalida:${codigo}`)
    return rechazoDeConfiguracion(codigo, 400)
  }

  const { data: credencialFilas, error: credencialError } = await admin.rpc('obtener_clave_perfil_ia', { p_perfil_id: politica.perfil_principal_id })
  const credencial = credencialFilas?.[0]
  if (credencialError || !credencial) {
    registrarConfiguracion('credencial_no_disponible')
    return rechazoDeConfiguracion('No se pudo resolver la credencial del proveedor de IA.', 500)
  }

  // Anthropic y OpenAI implementados — el adaptador real a usar lo decide
  // la política que un superadmin apruebe; cualquier otro falla con un
  // error claro en vez de armar un cuerpo de request con el formato
  // equivocado (nunca asumir un formato no verificado).
  if (credencial.adaptador !== 'anthropic' && credencial.adaptador !== 'openai') {
    registrarConfiguracion(`adaptador_no_soportado:${limpiarParaLog(credencial.adaptador, 64)}`)
    return rechazoDeConfiguracion(`El chat todavía no soporta el adaptador "${credencial.adaptador}" — solo Anthropic y OpenAI por ahora.`, 501)
  }

  const perfilLimiteSegundos = Math.min(Number(politica.limite_segundos) || CONTRATO.limiteSegundos, 90)
  const perfil: PerfilModelo = { id: politica.perfil_principal_id, proveedorCodigo: credencial.proveedor_codigo, modeloId: credencial.modelo_id }

  // Cupo persistente: 30 consultas por usuario y hora (configurable con CHAT_IA_LIMITE_HORA). Se consume después de TODOS los
  // chequeos (funcionalidad, conversación, política, entrada, credencial y adaptador) y justo antes de la primera escritura y de la
  // llamada al proveedor: un 429 no crea conversación ni mensaje. Agotado: 429 con Retry-After.
  const sinCupo = await rechazoPorCupo(admin, callerData.user.id, FUNCIONALIDAD_CHAT, limiteDeCupo(deps.limiteHora()), {
    agotado: 'Superaste el límite de mensajes por hora. Probá de nuevo más tarde.',
  })
  if (sinCupo) return jsonResponse({ error: sinCupo.error }, sinCupo.status, sinCupo.retryAfter ? { 'Retry-After': String(sinCupo.retryAfter) } : {})

  // Conversación nueva si no vino conversacion_id (si vino, ya se verificó arriba).
  if (!conversacionId) {
    const { data: nueva, error: nuevaError } = await asUser
      .from('conversaciones_chat_ia')
      .insert({ usuario_id: callerData.user.id })
      .select('id')
      .single()
    if (nuevaError || !nueva) {
      registrarErrorDeBase('chat-ia-responder: no se pudo crear la conversación', nuevaError)
      return jsonResponse({ error: 'No se pudo crear la conversación.' }, 500)
    }
    conversacionId = nueva.id
  }

  try {
    await guardarMensaje(asUser, { conversacion_id: conversacionId, origen: 'usuario', contenido: body.mensaje })
  } catch {
    console.error('chat-ia-responder: no se pudo guardar el mensaje del usuario')
    return jsonResponse({ error: 'No se pudo guardar tu mensaje.' }, 500)
  }

  async function responderError(mensaje: string, status: number) {
    // Mejor esfuerzo: el error ya se informa en la respuesta HTTP; si tampoco se puede guardar, no se pisa el status.
    await asUser.from('mensajes_chat_ia').insert({ conversacion_id: conversacionId, origen: 'chat', contenido: mensaje, estado: 'fallida' })
    return jsonResponse({ conversacion_id: conversacionId, error: mensaje }, status)
  }


  async function leer(vista: string, filtros: Record<string, string | number> = {}) {
    const { data: fuente } = await asUser.from('fuentes_chat_ia').select('feature_id, columnas').eq('vista', vista).maybeSingle()
    if (!fuente) return { error: 'FUENTE_NO_DISPONIBLE' }

    const { data: puedeLeer } = await asUser.rpc('puede_chat_leer_funcionalidad', { p_feature_id: fuente.feature_id })
    if (!puedeLeer) return { error: 'FUENTE_NO_DISPONIBLE' }

    // Tope de filas (F-IA-01, FR-023): se pide una de más para saber si hubo recorte y avisarlo al modelo.
    const seguros = filtrosSeguros(filtros)
    if (!seguros.ok) return { error: 'FILTROS_INVALIDOS' }
    // Columnas permitidas por vista (MSF-730): si `fuentes_chat_ia.columnas` está definida solo se piden esas; si es NULL
    // se mantiene `*` (fuentes existentes). Una lista inválida falla cerrado.
    const columnas = columnasParaSelect((fuente as { columnas?: unknown }).columnas)
    if (!columnas.ok) return { error: 'FUENTE_NO_DISPONIBLE' }
    // Con columnas definidas, tampoco se filtra por columnas no autorizadas (serviría de oráculo sobre datos que no se entregan).
    if (columnas.permitidas && Object.keys(seguros.filtros).some((clave) => !columnas.permitidas!.includes(clave))) return { error: 'FILTROS_INVALIDOS' }
    let query = asUser.from(vista).select(columnas.seleccion).limit(TOPE_FILAS_CONSULTA + 1)
    for (const [clave, valor] of Object.entries(seguros.filtros)) query = query.eq(clave, valor)
    const { data: filasLeidas, error } = await query
    if (error) return { error: 'ERROR_AL_LEER' }
    const acotado = acotarFilas(filasLeidas)
    // La vista ya es una fuente curada por un superadmin; sanitizarDato quita además las columnas con nombre de
    // secreto (password/token/cookie…) antes de que los datos salgan hacia el tercero.
    const primera = acotado.filas[0]
    const data = acotado.filas.length > 0
      ? sanitizarDato(acotado.filas, primera && typeof primera === 'object' ? Object.keys(primera as Record<string, unknown>) : []) as unknown[]
      : acotado.filas
    // CONTRATO.datosPermitidos es el allowlist de la ENTRADA (mensaje del
    // usuario) — no aplica acá. sanitizarDato(data, CONTRATO.datosPermitidos)
    // borraría casi todas las columnas de cualquier vista real (solo
    // dejaría pasar las que coincidieran por nombre con
    // 'mensaje'/'organizacion_id'). El límite de seguridad real de qué
    // datos puede ver el chat ya lo decide el superadmin al registrar la
    // vista en fuentes_chat_ia — no hace falta un segundo allowlist por
    // fila encima de eso.
    return acotado.truncado ? { filas: data, truncado: true, aviso: acotado.aviso } : { filas: data }
  }

  // Propone la acción — nunca la ejecuta acá. Ejecutar de verdad es
  // private.ejecutar_accion_chat_ia, llamada solo tras la confirmación
  // explícita del usuario en la UI.
  async function proponerEjecucion(rpc: string, parametros: Record<string, unknown>, descripcion: string) {
    // La propuesta se crea por RPC: el cliente ya no puede escribir accion_* (MSF-724).
    // Esa RPC es la única fuente de verdad de la allowlist: valida conversación
    // propia, que (feature, rpc) esté registrada y ejecutable por la
    // organización, que la acción sea ejecutable por el usuario y que los
    // parámetros sean los que la acción declara — y elige la feature de forma
    // determinista. Aquí no se pre-valida nada: con la misma rpc registrada en
    // dos features, este `.maybeSingle()` fallaba y la propuesta válida se
    // perdía (MSF-724).
    const { data: creada, error } = await asUser.rpc('proponer_accion_chat_ia', {
      p_conversacion_id: conversacionId,
      p_rpc: rpc,
      p_parametros: parametros,
      // Lo que ve quien confirma: la acción y los parámetros reales, no solo la redacción del modelo.
      p_descripcion: describirPropuesta(rpc, parametros, descripcion),
    })
    if (error || !creada?.propuesta) return { propuesta: false, motivo: 'ACCION_NO_DISPONIBLE' }
    return { propuesta: true }
  }

  // Compartido entre los dos adaptadores: ejecuta la herramienta pedida y
  // devuelve qué hacer — terminar la respuesta acá (propuesta creada o
  // acción rechazada) o seguir el ciclo con el resultado de "leer".
  // (ResultadoHerramienta viene de guardas.ts)
  const contenidoHerramienta = (valor: unknown) => marcarContenidoNoConfiable(JSON.stringify(valor))

  async function manejarHerramienta(name: string, input: Record<string, unknown>): Promise<ResultadoHerramienta> {
    if (name === 'ejecutar') {
      const i = input as { rpc?: string; parametros?: Record<string, unknown>; descripcion?: string }
      const resultado = i.rpc && i.descripcion
        ? await proponerEjecucion(i.rpc, i.parametros ?? {}, i.descripcion)
        : { propuesta: false }
      if (resultado.propuesta) return { tipo: 'propuesta' }
      return { tipo: 'rechazo', mensaje: 'Esa acción no está disponible para tu organización.' }
    }
    if (name === 'leer') {
      const i = input as { vista?: string; filtros?: Record<string, string | number> }
      const resultado = i.vista ? await leer(i.vista, i.filtros ?? {}) : { error: 'FUENTE_NO_DISPONIBLE' }
      return { tipo: 'resultado', valor: resultado }
    }
    return { tipo: 'resultado', valor: { error: 'HERRAMIENTA_DESCONOCIDA' } }
  }

  // ========================================================================
  // Ciclo Anthropic (Messages API)
  // ========================================================================
  async function cicloAnthropic(): Promise<Response> {
    const mensajes: Array<{ role: 'user' | 'assistant'; content: string | BloqueAnthropic[] }> = [
      { role: 'user', content: String(entradaSanitizada.mensaje) },
    ]

    async function llamar() {
      return await invocarProveedorIa(
        perfil,
        credencial.clave,
        { model: perfil.modeloId, max_tokens: MAX_TOKENS_RESPUESTA, system: deps.systemPrompt, tools: [HERRAMIENTA_LEER, HERRAMIENTA_EJECUTAR], messages: mensajes },
        deps.fetchProveedor(perfilLimiteSegundos),
      ) as { content: BloqueAnthropic[]; stop_reason: string }
    }

    let respuesta: { content: BloqueAnthropic[]; stop_reason: string }
    try {
      respuesta = await llamar()
    } catch (error) {
      console.error('chat-ia-responder: fallo al invocar proveedor', textoDeError(error))
      const fallo = falloDeProveedor(error)
      return await responderError(fallo.mensaje, fallo.status)
    }

    // Un único ciclo de tool-calling (alcance de este mecanismo). Si el modelo pide varias herramientas en el mismo
    // turno, la API exige un `tool_result` por cada `tool_use`: se resuelven todas.
    if (respuesta.stop_reason === 'tool_use') {
      const bloques = respuesta.content.filter((b): b is Extract<BloqueAnthropic, { type: 'tool_use' }> => b.type === 'tool_use')
      if (bloques.length > 0) {
        const turno = await resolverLlamadas(bloques.map((b) => ({ id: b.id, name: b.name, input: b.input })), manejarHerramienta)

        if (turno.tipo === 'propuesta') return jsonResponse({ conversacion_id: conversacionId, propuesta: true }, 200)
        if (turno.tipo === 'rechazo') {
          await guardarMensaje(asUser, { conversacion_id: conversacionId, origen: 'chat', contenido: turno.mensaje })
          return jsonResponse({ conversacion_id: conversacionId, respuesta: turno.mensaje }, 200)
        }

        mensajes.push({ role: 'assistant', content: respuesta.content })
        mensajes.push({ role: 'user', content: turno.resultados.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: contenidoHerramienta(r.valor) })) })

        try {
          respuesta = await llamar()
        } catch (error) {
          console.error('chat-ia-responder: fallo al invocar proveedor', textoDeError(error))
          const fallo = falloDeProveedor(error)
          return await responderError(fallo.mensaje, fallo.status)
        }
      }
    }

    const textoFinal = respuesta.content.find((b): b is Extract<BloqueAnthropic, { type: 'text' }> => b.type === 'text')?.text
      ?? 'No encontré información relevante para responder eso.'
    await guardarMensaje(asUser, { conversacion_id: conversacionId, origen: 'chat', contenido: textoFinal })
    return jsonResponse({ conversacion_id: conversacionId, respuesta: textoFinal }, 200)
  }

  // ========================================================================
  // Ciclo OpenAI (Chat Completions API) — formato de tool-calling distinto:
  // tools envueltas en {type:'function', function:{...}}, la respuesta trae
  // choices[0].message.tool_calls en vez de bloques content, y el
  // resultado de una herramienta vuelve como mensaje {role:'tool',
  // tool_call_id, content} en vez de un bloque tool_result.
  // ========================================================================
  async function cicloOpenAI(): Promise<Response> {
    const mensajes: MensajeOpenAI[] = [
      { role: 'system', content: deps.systemPrompt },
      { role: 'user', content: String(entradaSanitizada.mensaje) },
    ]

    async function llamar() {
      return await invocarProveedorIa(
        perfil,
        credencial.clave,
        { model: perfil.modeloId, max_tokens: MAX_TOKENS_RESPUESTA, tools: [herramientaOpenAI(HERRAMIENTA_LEER), herramientaOpenAI(HERRAMIENTA_EJECUTAR)], messages: mensajes },
        deps.fetchProveedor(perfilLimiteSegundos),
      ) as { choices: Array<{ message: { content: string | null; tool_calls?: ToolCallOpenAI[] }; finish_reason: string }> }
    }

    let respuesta: { choices: Array<{ message: { content: string | null; tool_calls?: ToolCallOpenAI[] }; finish_reason: string }> }
    try {
      respuesta = await llamar()
    } catch (error) {
      console.error('chat-ia-responder: fallo al invocar proveedor', textoDeError(error))
      const fallo = falloDeProveedor(error)
      return await responderError(fallo.mensaje, fallo.status)
    }

    let mensajeRespuesta = respuesta.choices[0]?.message

    if (mensajeRespuesta?.tool_calls && mensajeRespuesta.tool_calls.length > 0) {
      const llamadas = mensajeRespuesta.tool_calls.map((tc) => {
        let input: Record<string, unknown>
        try {
          const parsed = JSON.parse(tc.function.arguments)
          input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
          input = {}
        }
        return { id: tc.id, name: tc.function.name, input }
      })
      // La API exige un mensaje `tool` por cada `tool_call_id` del turno: se resuelven todos.
      const turno = await resolverLlamadas(llamadas, manejarHerramienta)

      if (turno.tipo === 'propuesta') return jsonResponse({ conversacion_id: conversacionId, propuesta: true }, 200)
      if (turno.tipo === 'rechazo') {
        await guardarMensaje(asUser, { conversacion_id: conversacionId, origen: 'chat', contenido: turno.mensaje })
        return jsonResponse({ conversacion_id: conversacionId, respuesta: turno.mensaje }, 200)
      }

      mensajes.push({ role: 'assistant', content: mensajeRespuesta.content, tool_calls: mensajeRespuesta.tool_calls })
      for (const r of turno.resultados) mensajes.push({ role: 'tool', tool_call_id: r.id, content: contenidoHerramienta(r.valor) })

      try {
        respuesta = await llamar()
      } catch (error) {
        console.error('chat-ia-responder: fallo al invocar proveedor', textoDeError(error))
        const fallo = falloDeProveedor(error)
        return await responderError(fallo.mensaje, fallo.status)
      }
      mensajeRespuesta = respuesta.choices[0]?.message
    }

    const textoFinal = mensajeRespuesta?.content ?? 'No encontré información relevante para responder eso.'
    await guardarMensaje(asUser, { conversacion_id: conversacionId, origen: 'chat', contenido: textoFinal })
    return jsonResponse({ conversacion_id: conversacionId, respuesta: textoFinal }, 200)
  }

  try {
    return credencial.adaptador === 'openai' ? await cicloOpenAI() : await cicloAnthropic()
  } catch (error) {
    // Un insert rechazado (RLS, conversación ajena, caída) ya no se ignora: se responde 500 en vez de «ok» sin historial.
    if (error instanceof ErrorPersistencia) {
      console.error('chat-ia-responder: no se pudo guardar la respuesta del chat')
      return jsonResponse({ conversacion_id: conversacionId, error: 'No se pudo guardar la respuesta del chat.' }, 500)
    }
    console.error('chat-ia-responder: error inesperado', textoDeError(error))
    return jsonResponse({ error: 'No se pudo procesar el mensaje.' }, 500)
  }
}
