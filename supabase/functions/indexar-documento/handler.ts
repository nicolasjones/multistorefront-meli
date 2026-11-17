// Lógica de `indexar-documento` con dependencias inyectadas para probarla sin Deno ni Supabase (handler.test.ts);
// `index.ts` solo cablea los clientes reales.
//
// Contrato: specs/.../contracts/indexacion-documento.md. Recibe un version_id ya creado (estado 'procesando', archivo
// ya subido a Storage por el frontend con la sesión del usuario). Descarga el objeto, extrae texto, fragmenta, genera
// embeddings por lotes (OpenAI) y activa la versión solo si todos los fragmentos se indexaron.
//
// Concurrencia: dos invocaciones sobre la misma versión no pueden indexar a la vez. La primera reclama la versión
// (compare-and-swap sobre `motivo_error`, ver reglas.ts); la segunda recibe 409. Una versión `fallida` nunca pisa a
// una `activa`: `marcarFallida` solo actúa mientras sigue `procesando`.
// Errores: los permanentes (documento sin texto, demasiado grande, permiso 42501 al activar) dejan la versión `fallida`;
// los transitorios (proveedor, storage, base) sueltan la reclamación y dejan la versión `procesando`: no hay reintento
// automático ni barrido, el reintento es manual (botón «Reintentar» de la pantalla de Documentos IA).
import { rechazoPorFuncionalidad } from '../_shared/acceso-ia.ts'
import { MAX_FRAGMENTOS, fragmentarTexto, nuevoReclamo, reclamoVigente } from './reglas.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const respuesta = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const SIN_PERMISO = 'No tenés permiso para indexar este documento.'
const MOTIVO_ENTRADA_INVALIDA = 'La configuración de IA de tu organización no permite indexar este documento. Contactá a un administrador.'
const MOTIVO_SIN_PERMISO = 'No tenés permiso para activar esta versión: la búsqueda documental no está habilitada o solo puede activarla quien la subió o un administrador.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VersionDoc = { subida_por: string | null; id: string; estado: string; motivo_error: string | null; storage_path: string; nombre: string; organizacion_id: string }
type Politica = { politica_id: string; contrato_id: string; perfil_principal_id: string; limite_intentos: number; limite_segundos: number; perfil_fallback_id: string | null }
type Credencial = { clave: string; proveedor_codigo: string }

export type Deps = {
  getUser(jwt: string): Promise<{ id: string } | null>
  /** `tiene_feature_publica('busqueda-documental')` con el JWT del usuario. */
  feature(jwt: string): Promise<{ data: unknown; error: unknown }>
  /** `contexto_panel_actual()` con el JWT del usuario (organización activa y rol efectivo); null si no se pudo leer. */
  contexto(jwt: string): Promise<{ organizacion_id: string | null; rol_efectivo: string | null; es_superadmin: boolean } | null>
  // Todo lo que sigue corre con la sesión del usuario (RLS), salvo `politica` y `credencial` (service-role, solo lectura de gobernanza).
  version(jwt: string, id: string): Promise<VersionDoc | null>
  reclamar(jwt: string, id: string, motivoPrevio: string | null, reclamo: string): Promise<boolean>
  soltar(jwt: string, id: string, reclamo: string): Promise<void>
  /** Falso si la base rechazó o no pudo aplicar el update (se registra en `index.ts`). */
  marcarFallida(jwt: string, id: string, motivo: string, reclamo: string): Promise<boolean>
  estado(jwt: string, id: string): Promise<string | null>
  descargar(jwt: string, ruta: string): Promise<Uint8Array | null>
  extraerTexto(bytes: Uint8Array, nombre: string): Promise<string | null>
  politica(): Promise<Politica | null>
  credencial(perfilId: string): Promise<Credencial | null>
  validarEntrada(politica: Politica, texto: string): void
  embeddings(textos: string[], clave: string): Promise<number[][]>
  borrarFragmentos(jwt: string, versionId: string, reclamo: string): Promise<boolean>
  insertarFragmentos(jwt: string, filas: Array<{ version_id: string; organizacion_id: string; texto: string; embedding: string; orden: number }>): Promise<boolean>
  /** `permiso` = la base rechazó con 42501 (funcionalidad apagada, o no es quien subió ni administrador). */
  /** `invalida` = 22023 (versión ya procesada, ajena o inexistente para la base): no se reintenta. */
  activar(jwt: string, versionId: string): Promise<'ok' | 'permiso' | 'invalida' | 'error'>
  ahora(): number
  id(): string
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respuesta({ error: 'Método no soportado, usar POST.' }, 400)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return respuesta({ error: 'No autorizado' }, 403)
  const usuario = await deps.getUser(jwt)
  if (!usuario) return respuesta({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => null) as { version_id?: unknown } | null
  const versionId = body?.version_id
  if (typeof versionId !== 'string' || !UUID.test(versionId)) return respuesta({ error: 'Falta "version_id".' }, 400)

  // AUTORIZACIÓN PREVIA, antes de reclamar, descargar, gastar crédito o tocar fragmentos: la RLS deja a cualquier
  // miembro de la organización actualizar versiones, pero indexar (y activar) solo le corresponde a quien subió la
  // versión o a un administrador de esa organización (misma regla que `activar_version_documento`).
  const sinFeature = rechazoPorFuncionalidad(await deps.feature(jwt), { noHabilitada: SIN_PERMISO, noVerificable: 'No se pudo verificar la funcionalidad de búsqueda documental.' })
  if (sinFeature) return respuesta({ error: sinFeature.error }, sinFeature.status)

  const version = await deps.version(jwt, versionId)
  // Versión inexistente, de otra organización o sin permiso: el MISMO 403, sin revelar si existe.
  if (!version) return respuesta({ error: SIN_PERMISO }, 403)
  const esQuienSubio = version.subida_por !== null && version.subida_por === usuario.id
  // El contexto (rol) solo hace falta si NO es quien subió la versión; un fallo al leerlo cuenta como «sin contexto».
  let contexto: Awaited<ReturnType<Deps['contexto']>> = null
  if (!esQuienSubio) {
    try { contexto = await deps.contexto(jwt) } catch (error) { console.error('indexar-documento: no se pudo leer el contexto', error instanceof Error ? error.message : error) }
  }
  // Falla cerrado: si no se puede resolver el rol (error del RPC de contexto) y no es quien subió, no se puede decidir
  // el permiso de administrador → 503 (no es un «no» definitivo), sin tocar nada.
  if (!contexto && !esQuienSubio) return respuesta({ error: 'No se pudo verificar tu permiso, probá de nuevo.' }, 503)
  // Un superadmin queda fuera aunque sea además administrador real de la organización: criterio conservador hasta que
  // exista la RPC pública `puede_indexar_version` (ver docs/funciones-edge-endurecimiento.md).
  const esAdministrador = !!contexto && !contexto.es_superadmin && contexto.rol_efectivo === 'administrador' && contexto.organizacion_id === version.organizacion_id
  if (!esQuienSubio && !esAdministrador) return respuesta({ error: SIN_PERMISO }, 403)
  if (version.estado !== 'procesando') return respuesta({ error: 'Esta versión ya fue procesada.', codigo: 'no_procesable' }, 409)
  if (reclamoVigente(version.motivo_error, deps.ahora())) return respuesta({ error: 'Esta versión ya se está indexando.', codigo: 'ocupado' }, 409)

  const reclamo = nuevoReclamo(deps.ahora(), deps.id())
  if (!(await deps.reclamar(jwt, versionId, version.motivo_error, reclamo))) return respuesta({ error: 'Esta versión ya se está indexando.', codigo: 'ocupado' }, 409)

  // Soltar el candado nunca debe lanzar; si falla, el candado queda vigente hasta que venza (10 min): se deja rastro.
  const soltarSeguro = async () => {
    try { await deps.soltar(jwt, versionId, reclamo) } catch (error) {
      console.error('indexar-documento: no se pudo soltar el candado, vence solo en 10 minutos', error instanceof Error ? error.message : error)
    }
  }
  const yaActiva = async () => (await deps.estado(jwt, versionId)) === 'activa'
  const respuestaIdempotente = () => respuesta({ version_id: versionId, ya_activa: true }, 200)
  const noExiste = () => respuesta({ error: 'Esta versión ya no existe.' }, 404)
  const ocupada = () => respuesta({ error: 'Esta versión ya se está indexando.', codigo: 'ocupado' }, 409)

  // Los fragmentos solo se borran si esta invocación SIGUE siendo la dueña de la versión: relee la versión y exige
  // `procesando` con su propio reclamo. Así nunca se borran los de una versión ya `activa` ni los de otra invocación
  // que retomó la versión tras vencer el reclamo propio. La relectura evita el viaje en el caso común; el borrado real
  // (`borrar_fragmentos_si_dueno`) vuelve a comprobar la propiedad y borra en la MISMA transacción (cierra la ventana).
  type Propiedad = 'dueno' | 'activa' | 'ajena' | 'inexistente'
  const propiedad = async (): Promise<Propiedad> => {
    const actual = await deps.version(jwt, versionId)
    if (!actual) return 'inexistente'
    if (actual.estado === 'activa') return 'activa'
    return actual.estado === 'procesando' && actual.motivo_error === reclamo ? 'dueno' : 'ajena'
  }
  const borrarSiDueno = async (): Promise<boolean> => {
    try {
      if ((await propiedad()) !== 'dueno') return false
      return await deps.borrarFragmentos(jwt, versionId, reclamo)
    } catch (error) {
      console.error('indexar-documento: no se pudieron borrar los fragmentos', error instanceof Error ? error.message : error)
      return false
    }
  }

  // Registra la versión como `fallida` (solo si sigue `procesando`) y recién entonces borra sus fragmentos. Si no se
  // aplicó porque otra invocación ya la activó (carrera), no se borra nada y la respuesta es idempotente (200); si no se
  // pudo por otra causa, se suelta el candado y es reintentable (502).
  const dejarFallida = async (motivo: string): Promise<Response | null> => {
    const dueno = await propiedad()
    if (dueno === 'activa') return respuestaIdempotente()
    if (dueno === 'inexistente') return noExiste()
    if (dueno === 'ajena') return ocupada()
    if (await deps.marcarFallida(jwt, versionId, motivo, reclamo)) {
      // Ya `fallida`: sus fragmentos no sirven. Mejor esfuerzo; si falla queda rastro en el log.
      try { await deps.borrarFragmentos(jwt, versionId, reclamo) } catch (error) { console.error('indexar-documento: no se pudieron borrar los fragmentos', error instanceof Error ? error.message : error) }
      return null
    }
    if (await yaActiva()) return respuestaIdempotente()
    await soltarSeguro()
    return respuesta({ error: 'No se pudo registrar el resultado, probá de nuevo.' }, 502)
  }
  // Error permanente: la versión queda `fallida`.
  const fallar = async (motivo: string) => (await dejarFallida(motivo)) ?? respuesta({ error: motivo }, 422)
  // Error transitorio: se libera la reclamación y se puede reintentar con la misma versión.
  const reintentable = async (mensaje: string, status: number) => {
    await borrarSiDueno()
    await soltarSeguro()
    return respuesta({ error: mensaje }, status)
  }

  try {
    const bytes = await deps.descargar(jwt, version.storage_path)
    if (!bytes) return await reintentable('No se pudo descargar el archivo subido, probá de nuevo.', 502)

    const texto = await deps.extraerTexto(bytes, version.nombre)
    if (!texto || !texto.trim()) return await fallar('No pudimos extraer texto de este documento — formato no soportado o sin contenido legible.')

    const fragmentos = fragmentarTexto(texto)
    if (fragmentos.length === 0) return await fallar('El documento no tiene contenido para indexar.')
    if (fragmentos.length > MAX_FRAGMENTOS) return await fallar(`El documento es demasiado largo para indexarlo (máximo ${MAX_FRAGMENTOS} fragmentos). Dividilo en partes.`)

    // Gobernanza real: sin política aprobada falla cerrado — gate humano vía /ia/contratos y /ia/politicas.
    const politica = await deps.politica()
    if (!politica) return await reintentable('Búsqueda documental no está configurada todavía: falta una política aprobada para "rag-busqueda-documental". Un superadmin debe crearla en /ia/contratos y /ia/politicas.', 503)
    const credencial = await deps.credencial(politica.perfil_principal_id)
    if (!credencial) return await reintentable('No se pudo resolver la credencial del proveedor de IA.', 503)
    if (credencial.proveedor_codigo !== 'openai') return await reintentable(`Búsqueda documental todavía no soporta el proveedor "${credencial.proveedor_codigo}" para embeddings — solo OpenAI por ahora.`, 501)

    try {
      deps.validarEntrada(politica, fragmentos[0])
    } catch (error) {
      // El código interno (p. ej. POLITICA_IA_INACTIVA) va al log; al usuario y a `motivo_error` solo un texto fijo.
      console.error('indexar-documento: entrada rechazada por la política de IA', error instanceof Error ? error.message : error)
      return await fallar(MOTIVO_ENTRADA_INVALIDA)
    }

    let embeddings: number[][]
    try {
      embeddings = await deps.embeddings(fragmentos, credencial.clave)
    } catch (error) {
      console.error('indexar-documento: fallo de embeddings', error instanceof Error ? error.message : error)
      return await reintentable('No pude generar los embeddings de este documento, probá de nuevo.', 502)
    }

    // Una reclamación que venció durante un proveedor lento puede haber sido retomada: no pisar a la otra invocación.
    // Los fragmentos previos de esta versión (de un intento anterior) se borran antes de insertar.
    const preparados = await propiedad()
    if (preparados === 'activa') return respuestaIdempotente()
    if (preparados === 'inexistente') return noExiste()
    if (preparados === 'ajena') return ocupada()
    if (!(await deps.borrarFragmentos(jwt, versionId, reclamo))) return await reintentable('No se pudieron preparar los fragmentos indexados, probá de nuevo.', 502)
    const filas = fragmentos.map((t, i) => ({ version_id: versionId, organizacion_id: version.organizacion_id, texto: t, embedding: `[${embeddings[i].join(',')}]`, orden: i }))
    if (!(await deps.insertarFragmentos(jwt, filas))) return await reintentable('No se pudieron guardar los fragmentos indexados, probá de nuevo.', 502)

    // Activación atómica (RPC): reemplaza la versión activa anterior y activa esta en una sola transacción.
    const activacion = await deps.activar(jwt, versionId)
    if (activacion !== 'ok') {
      // Si otra invocación la activó entre tanto, el resultado ya es el esperado: no se marca fallida ni se tocan sus fragmentos.
      if (await yaActiva()) return respuesta({ version_id: versionId, fragmentos: filas.length }, 200)
      // 22023: la base dice que la versión ya no se puede activar (ya procesada, ajena o inexistente): no es
      // transitorio ni se marca `fallida`. Se borran los fragmentos de ESTE intento, se suelta el candado y se responde
      // un 409 genérico (404 genérico si la versión ya no existe), así la pantalla no repite un intento que fallará igual.
      if (activacion === 'invalida') {
        const actual = await deps.version(jwt, versionId)
        if (!actual) { await soltarSeguro(); return respuesta({ error: 'Esta versión ya no existe.' }, 404) }
        if (actual.estado === 'activa') return respuestaIdempotente()
        // Solo se borra si la versión sigue siendo nuestra o ya no está en juego (no `activa`, no retomada por otra).
        if (!(actual.estado === 'procesando' && actual.motivo_error !== reclamo)) {
          try { await deps.borrarFragmentos(jwt, versionId, reclamo) } catch (error) { console.error('indexar-documento: no se pudieron borrar los fragmentos', error instanceof Error ? error.message : error) }
        }
        await soltarSeguro()
        return respuesta({ error: 'Esta versión ya no se puede procesar.', codigo: 'no_procesable' }, 409)
      }
      // Un rechazo de permisos NO es transitorio (reintentar da lo mismo): la versión queda `fallida` con un motivo
      // claro. Quien llega acá ya pasó la autorización previa (subió la versión o es administrador); la única forma de
      // que la base lo rechace es una carrera (p. ej. un administrador degradado durante la indexación): en ese caso
      // la versión igual queda `fallida` y es quien subió o un administrador vigente quien la reintenta subiendo de nuevo.
      if (activacion === 'permiso') {
        const resultado = await dejarFallida(MOTIVO_SIN_PERMISO)
        return resultado ?? respuesta({ error: MOTIVO_SIN_PERMISO }, 403)
      }
      return await reintentable('No se pudo activar la nueva versión, probá de nuevo.', 502)
    }
    return respuesta({ version_id: versionId, fragmentos: filas.length }, 200)
  } catch (error) {
    console.error('indexar-documento: error inesperado', error instanceof Error ? error.message : error)
    return await reintentable('No se pudo indexar el documento, probá de nuevo.', 500)
  }
}
