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
// Errores: los permanentes (documento sin texto, demasiado grande) dejan la versión `fallida`; los transitorios
// (proveedor, storage, base) sueltan la reclamación y dejan la versión `procesando` para reintentar.
import { MAX_FRAGMENTOS, fragmentarTexto, nuevoReclamo, reclamoVigente } from './reglas.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const respuesta = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VersionDoc = { id: string; estado: string; motivo_error: string | null; storage_path: string; nombre: string; organizacion_id: string }
type Politica = { politica_id: string; contrato_id: string; perfil_principal_id: string; limite_intentos: number; limite_segundos: number; perfil_fallback_id: string | null }
type Credencial = { clave: string; proveedor_codigo: string }

export type Deps = {
  getUser(jwt: string): Promise<{ id: string } | null>
  // Todo lo que sigue corre con la sesión del usuario (RLS), salvo `politica` y `credencial` (service-role, solo lectura de gobernanza).
  version(jwt: string, id: string): Promise<VersionDoc | null>
  reclamar(jwt: string, id: string, motivoPrevio: string | null, reclamo: string): Promise<boolean>
  soltar(jwt: string, id: string, reclamo: string): Promise<void>
  marcarFallida(jwt: string, id: string, motivo: string): Promise<void>
  estado(jwt: string, id: string): Promise<string | null>
  descargar(jwt: string, ruta: string): Promise<Uint8Array | null>
  extraerTexto(bytes: Uint8Array, nombre: string): Promise<string | null>
  politica(): Promise<Politica | null>
  credencial(perfilId: string): Promise<Credencial | null>
  validarEntrada(politica: Politica, texto: string): void
  embeddings(textos: string[], clave: string): Promise<number[][]>
  borrarFragmentos(jwt: string, versionId: string): Promise<boolean>
  insertarFragmentos(jwt: string, filas: Array<{ version_id: string; organizacion_id: string; texto: string; embedding: string; orden: number }>): Promise<boolean>
  activar(jwt: string, versionId: string): Promise<boolean>
  ahora(): number
  id(): string
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respuesta({ error: 'Método no soportado, usar POST.' }, 400)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return respuesta({ error: 'No autorizado' }, 403)
  if (!(await deps.getUser(jwt))) return respuesta({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => null) as { version_id?: unknown } | null
  const versionId = body?.version_id
  if (typeof versionId !== 'string' || !UUID.test(versionId)) return respuesta({ error: 'Falta "version_id".' }, 400)

  const version = await deps.version(jwt, versionId)
  if (!version) return respuesta({ error: 'Versión no encontrada.' }, 404)
  if (version.estado !== 'procesando') return respuesta({ error: 'Esta versión ya fue procesada.' }, 409)
  if (reclamoVigente(version.motivo_error, deps.ahora())) return respuesta({ error: 'Esta versión ya se está indexando.' }, 409)

  const reclamo = nuevoReclamo(deps.ahora(), deps.id())
  if (!(await deps.reclamar(jwt, versionId, version.motivo_error, reclamo))) return respuesta({ error: 'Esta versión ya se está indexando.' }, 409)

  // Error permanente: la versión queda `fallida` (solo si sigue `procesando`).
  const fallar = async (motivo: string) => {
    await deps.borrarFragmentos(jwt, versionId)
    await deps.marcarFallida(jwt, versionId, motivo)
    return respuesta({ error: motivo }, 422)
  }
  // Error transitorio: se libera la reclamación y se puede reintentar con la misma versión.
  const reintentable = async (mensaje: string, status: number) => {
    await deps.borrarFragmentos(jwt, versionId)
    await deps.soltar(jwt, versionId, reclamo)
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
      return await fallar(error instanceof Error ? error.message : 'ENTRADA_IA_INVALIDA')
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
    if (!(await deps.borrarFragmentos(jwt, versionId))) return await reintentable('No se pudieron preparar los fragmentos indexados, probá de nuevo.', 502)
    const filas = fragmentos.map((t, i) => ({ version_id: versionId, organizacion_id: version.organizacion_id, texto: t, embedding: `[${embeddings[i].join(',')}]`, orden: i }))
    if (!(await deps.insertarFragmentos(jwt, filas))) return await reintentable('No se pudieron guardar los fragmentos indexados, probá de nuevo.', 502)

    // Activación atómica (RPC): reemplaza la versión activa anterior y activa esta en una sola transacción.
    if (!(await deps.activar(jwt, versionId))) {
      // Si otra invocación la activó entre tanto, el resultado ya es el esperado: no se marca fallida ni se tocan sus fragmentos.
      if ((await deps.estado(jwt, versionId)) === 'activa') return respuesta({ version_id: versionId, fragmentos: filas.length }, 200)
      return await reintentable('No se pudo activar la nueva versión, probá de nuevo.', 502)
    }
    return respuesta({ version_id: versionId, fragmentos: filas.length }, 200)
  } catch (error) {
    console.error('indexar-documento: error inesperado', error instanceof Error ? error.message : error)
    return await reintentable('No se pudo indexar el documento, probá de nuevo.', 500)
  }
}
