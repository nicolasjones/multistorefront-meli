// Contrato: specs/.../contracts/indexacion-documento.md. La lógica vive en handler.ts (con tests); acá solo se cablean
// los clientes reales: la sesión del usuario (RLS) para los datos de negocio y service-role para resolver la política
// y la credencial de IA y, tras autorizar con el usuario, para escribir/borrar los fragmentos de la versión autorizada.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { prepararInvocacion, sanitizarDato, type ContratoConsumidor } from '../_shared/ia/index.ts'
import { generarEmbeddings } from '../_shared/embeddings.ts'
import { manejar, type Deps, type VersionDoc } from './handler.ts'
import { consultaMarcarFallida, consultaReclamar, consultaSoltar, llamarBorrarFragmentosSiDueno } from './consultas.ts'
import { escrituraFragmentos, type ClienteFragmentos } from './fragmentos.ts'
import { puedeGestionarDocumentos } from './reglas.ts'

const CONSUMIDOR_CODIGO = 'rag-busqueda-documental'
const CONTRATO: ContratoConsumidor = {
  codigo: CONSUMIDOR_CODIGO,
  version: 1,
  esquemaEntrada: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  esquemaSalida: { type: 'object', properties: { embedding: { type: 'array' } }, required: ['embedding'] },
  datosPermitidos: ['texto', 'organizacion_id'],
  limiteIntentos: 1,
  limiteSegundos: 60,
  claveAislamientoOrganizacion: 'organizacion_id',
}
const LOTE_INSERCION = 100

async function extraerTexto(bytes: Uint8Array, nombre: string): Promise<string | null> {
  const ext = nombre.toLowerCase().split('.').pop()
  try {
    if (ext === 'txt') return new TextDecoder('utf-8').decode(bytes)
    if (ext === 'pdf') {
      const { default: pdfParse } = await import('npm:pdf-parse@1.1.1')
      const resultado = await pdfParse(bytes)
      return resultado.text || null
    }
    if (ext === 'docx') {
      const mammoth = await import('npm:mammoth@1.8.0')
      const resultado = await mammoth.extractRawText({ buffer: bytes as never })
      return resultado.value || null
    }
  } catch {
    return null
  }
  return null
}

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Los datos de negocio se leen/actualizan con la sesión del usuario: la versión debe pertenecer a su organización (RLS).
  const comoUsuario = (jwt: string) => createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })

  // La versión tal como la ve el usuario por RLS (null si no existe, es de otra organización o no tiene acceso).
  const versionDelUsuario = async (jwt: string, versionId: string): Promise<{ organizacion_id: string } | null> => {
    const { data, error } = await comoUsuario(jwt).from('versiones_documento').select('id, documentos(organizacion_id)').eq('id', versionId).maybeSingle()
    // deno-lint-ignore no-explicit-any
    const doc = (data as any)?.documentos as { organizacion_id: string } | null | undefined
    return error || !data || !doc ? null : { organizacion_id: doc.organizacion_id }
  }

  const servicioFragmentos: ClienteFragmentos = {
    // Borrado condicional atómico (public.borrar_fragmentos_si_dueno): solo si la versión sigue en manos de este reclamo.
    borrar: (versionId, organizacionId, reclamo) => llamarBorrarFragmentosSiDueno(admin, versionId, organizacionId, reclamo),
    insertar: (filas) => admin.from('fragmentos_indexados').insert(filas),
  }

  const deps: Deps = {
    getUser: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id }
    },
    feature: async (jwt) => await comoUsuario(jwt).rpc('tiene_feature_publica', { p_feature_id: 'busqueda-documental' }),
    contexto: async (jwt) => {
      const { data, error } = await comoUsuario(jwt).rpc('contexto_panel_actual').single()
      return error || !data ? null : data as { organizacion_id: string | null; rol_efectivo: string | null; es_superadmin: boolean }
    },
    version: async (jwt, id) => {
      const { data, error } = await comoUsuario(jwt).from('versiones_documento')
        .select('id, estado, motivo_error, storage_path, subida_por, documentos(nombre, organizacion_id)').eq('id', id).maybeSingle()
      if (error || !data) return null
      // deno-lint-ignore no-explicit-any
      const doc = (data as any).documentos as { nombre: string; organizacion_id: string } | null
      if (!doc) return null
      return { subida_por: data.subida_por, id: data.id, estado: data.estado, motivo_error: data.motivo_error, storage_path: data.storage_path, nombre: doc.nombre, organizacion_id: doc.organizacion_id } satisfies VersionDoc
    },
    reclamar: async (jwt, id, motivoPrevio, reclamo) => {
      const { data, error } = await consultaReclamar(comoUsuario(jwt), id, motivoPrevio, reclamo)
      return !error && (data?.length ?? 0) === 1
    },
    soltar: async (jwt, id, reclamo) => {
      const { error } = await consultaSoltar(comoUsuario(jwt), id, reclamo)
      if (error) throw new Error(`soltar: ${error.code ?? ''} ${error.message}`)
    },
    // Solo mientras sigue `procesando`: una versión ya activa (o reemplazada) nunca se pisa a `fallida`.
    marcarFallida: async (jwt, id, motivo, reclamo) => {
      const { data, error } = await consultaMarcarFallida(comoUsuario(jwt), id, motivo, reclamo)
      if (error) console.error('indexar-documento: no se pudo marcar la versión fallida', error.code ?? '', error.message)
      return !error && (data?.length ?? 0) === 1
    },
    estado: async (jwt, id) => (await comoUsuario(jwt).from('versiones_documento').select('estado').eq('id', id).maybeSingle()).data?.estado ?? null,
    descargar: async (jwt, ruta) => {
      const { data, error } = await comoUsuario(jwt).storage.from('documentos-rag').download(ruta)
      return error || !data ? null : new Uint8Array(await data.arrayBuffer())
    },
    extraerTexto,
    politica: async () => {
      const { data, error } = await admin.rpc('resolver_politica_ia', { p_codigo: CONSUMIDOR_CODIGO })
      return error ? null : data?.[0] ?? null
    },
    credencial: async (perfilId) => {
      const { data, error } = await admin.rpc('obtener_clave_perfil_ia', { p_perfil_id: perfilId })
      return error ? null : data?.[0] ?? null
    },
    validarEntrada: (politica, texto) => {
      prepararInvocacion(
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
        { texto },
        // 0, no 1: intentos ya consumidos antes de esta llamada (con 1, 1 >= limiteIntentos(1) siempre tira LIMITE_INTENTOS_IA).
        0,
        new Date(),
      )
    },
    embeddings: (textos, clave) => generarEmbeddings(textos.map((t) => (sanitizarDato({ texto: t }, CONTRATO.datosPermitidos) as { texto: string }).texto), clave),
    // Los fragmentos se escriben y borran con el cliente de SERVICIO (así la indexación no depende del rol del usuario), pero
    // SOLO después de la autorización del handler y acotado a la versión y organización que el usuario ve por RLS (fragmentos.ts).
    ...escrituraFragmentos(servicioFragmentos, versionDelUsuario, LOTE_INSERCION),
    puedeGestionar: async (jwt) => {
      const { data, error } = await comoUsuario(jwt).rpc('contexto_panel_actual').single()
      return !error && !!data && puedeGestionarDocumentos(data as { rol_efectivo: string | null; es_superadmin: boolean })
    },
    activar: async (jwt, versionId) => {
      const cliente = comoUsuario(jwt)
      const { error } = await cliente.rpc('activar_version_documento', { p_version_id: versionId })
      if (error) return error.code === '42501' ? 'permiso' : error.code === '22023' ? 'invalida' : 'error'
      // Libera la marca de reclamación (ya no aplica a una versión activa); si falla, no afecta al resultado.
      await cliente.from('versiones_documento').update({ motivo_error: null }).eq('id', versionId).eq('estado', 'activa')
      return 'ok'
    },
    ahora: () => Date.now(),
    id: () => crypto.randomUUID(),
  }
  return manejar(req, deps)
})
