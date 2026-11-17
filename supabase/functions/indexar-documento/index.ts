// Contrato: specs/.../contracts/indexacion-documento.md. La lógica vive en handler.ts (con tests); acá solo se cablean
// los clientes reales: la sesión del usuario (RLS) para los datos de negocio y service-role únicamente para resolver
// la política y la credencial de IA.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { prepararInvocacion, sanitizarDato, type ContratoConsumidor } from '../_shared/ia/index.ts'
import { generarEmbeddings } from '../_shared/embeddings.ts'
import { manejar, type Deps, type VersionDoc } from './handler.ts'

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
  // Nunca service-role para datos de negocio: la versión debe pertenecer a la organización del usuario (RLS).
  const comoUsuario = (jwt: string) => createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })

  const deps: Deps = {
    getUser: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id }
    },
    version: async (jwt, id) => {
      const { data, error } = await comoUsuario(jwt).from('versiones_documento')
        .select('id, estado, motivo_error, storage_path, documentos(nombre, organizacion_id)').eq('id', id).maybeSingle()
      if (error || !data) return null
      // deno-lint-ignore no-explicit-any
      const doc = (data as any).documentos as { nombre: string; organizacion_id: string } | null
      if (!doc) return null
      return { id: data.id, estado: data.estado, motivo_error: data.motivo_error, storage_path: data.storage_path, nombre: doc.nombre, organizacion_id: doc.organizacion_id } satisfies VersionDoc
    },
    reclamar: async (jwt, id, motivoPrevio, reclamo) => {
      let q = comoUsuario(jwt).from('versiones_documento').update({ motivo_error: reclamo }).eq('id', id).eq('estado', 'procesando')
      q = motivoPrevio === null ? q.is('motivo_error', null) : q.eq('motivo_error', motivoPrevio)
      const { data, error } = await q.select('id')
      return !error && (data?.length ?? 0) === 1
    },
    soltar: async (jwt, id, reclamo) => {
      await comoUsuario(jwt).from('versiones_documento').update({ motivo_error: null }).eq('id', id).eq('estado', 'procesando').eq('motivo_error', reclamo)
    },
    // Solo mientras sigue `procesando`: una versión ya activa (o reemplazada) nunca se pisa a `fallida`.
    marcarFallida: async (jwt, id, motivo) => {
      await comoUsuario(jwt).from('versiones_documento').update({ estado: 'fallida', motivo_error: motivo }).eq('id', id).eq('estado', 'procesando')
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
    borrarFragmentos: async (jwt, versionId) => !(await comoUsuario(jwt).from('fragmentos_indexados').delete().eq('version_id', versionId)).error,
    insertarFragmentos: async (jwt, filas) => {
      const cliente = comoUsuario(jwt)
      for (let i = 0; i < filas.length; i += LOTE_INSERCION) {
        if ((await cliente.from('fragmentos_indexados').insert(filas.slice(i, i + LOTE_INSERCION))).error) return false
      }
      return true
    },
    activar: async (jwt, versionId) => {
      const cliente = comoUsuario(jwt)
      if ((await cliente.rpc('activar_version_documento', { p_version_id: versionId })).error) return false
      // Libera la marca de reclamación (ya no aplica a una versión activa); si falla, no afecta al resultado.
      await cliente.from('versiones_documento').update({ motivo_error: null }).eq('id', versionId).eq('estado', 'activa')
      return true
    },
    ahora: () => Date.now(),
    id: () => crypto.randomUUID(),
  }
  return manejar(req, deps)
})
