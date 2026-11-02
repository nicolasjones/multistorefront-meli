import { Alert, Box, Button, Chip, IconButton, List as MuiList, ListItem, ListItemText, Stack, TextField, Tooltip } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { List } from '@refinedev/mui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { useContextoPanel } from '../../context/ContextoPanel'
import { BUCKET_DOCUMENTOS, mimeDeDocumento, validarArchivoDocumento } from '../../lib/documentosIa'
import { supabaseClient } from '../../lib/supabase'

type Documento = { id: string; nombre: string; creado_en: string }
type VersionDocumento = { id: string; estado: string; subida_en: string; motivo_error: string | null }

const MENSAJE_FUNCIONALIDAD = 'No pudimos verificar si la búsqueda documental está habilitada para tu organización. Revisá la conexión e intentá de nuevo.'
const MENSAJE_CARGA = 'No pudimos cargar los documentos. Revisá la conexión e intentá de nuevo.'

/**
 * Limpieza compensatoria (MSF-699): si la subida falla antes de registrar la
 * versión, no quedan ni el objeto en el bucket ni la fila de `documentos`
 * (documento huérfano). Es *best effort*: si falla, se loguea y el mensaje que
 * ve el usuario sigue siendo el de la causa real.
 */
async function limpiarSubidaIncompleta(docId: string | null, documentoCreado: boolean, storagePath: string | null): Promise<void> {
  if (storagePath) {
    try {
      const { error } = await supabaseClient.storage.from(BUCKET_DOCUMENTOS).remove([storagePath])
      if (error) console.error('No pudimos borrar el archivo que no se pudo registrar.', error)
    } catch (excepcion) {
      console.error('No pudimos borrar el archivo que no se pudo registrar.', excepcion)
    }
  }
  if (docId && documentoCreado) {
    try {
      const { error } = await supabaseClient.from('documentos').delete().eq('id', docId)
      if (error) console.error('No pudimos borrar el documento que quedó sin versión.', error)
    } catch (excepcion) {
      console.error('No pudimos borrar el documento que quedó sin versión.', excepcion)
    }
  }
}

export function IaDocumentos() {
  const { contexto, isLoading: cargandoContexto } = useContextoPanel()
  const [habilitado, setHabilitado] = useState<boolean | null>(null)
  const [errorHabilitado, setErrorHabilitado] = useState<string | null>(null)
  const [documentos, setDocumentos] = useState<Documento[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [versionesPorDocumento, setVersionesPorDocumento] = useState<Record<string, VersionDocumento[]>>({})
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState('')
  const [preguntando, setPreguntando] = useState(false)
  const [respuesta, setRespuesta] = useState<{ texto: string; citas: number } | null>(null)
  const inputArchivoRef = useRef<HTMLInputElement>(null)
  const documentoAActualizarRef = useRef<string | null>(null)

  const verificarHabilitado = useCallback(async () => {
    setHabilitado(null)
    setErrorHabilitado(null)
    try {
      const { data, error: errorFeature } = await supabaseClient.rpc('tiene_feature_publica', { p_feature_id: 'busqueda-documental' })
      // Un error de la RPC NO es «no habilitada»: se distingue para no
      // mandar al usuario a un mensaje que lo confunde (MSF-699).
      if (errorFeature) {
        console.error('No pudimos verificar la funcionalidad de búsqueda documental.', errorFeature)
        setErrorHabilitado(MENSAJE_FUNCIONALIDAD)
        return
      }
      setHabilitado(Boolean(data))
    } catch (excepcion) {
      console.error('No pudimos verificar la funcionalidad de búsqueda documental.', excepcion)
      setErrorHabilitado(MENSAJE_FUNCIONALIDAD)
    }
  }, [])

  useEffect(() => {
    if (!contexto?.organizacion_id) return
    void verificarHabilitado()
  }, [contexto?.organizacion_id, verificarHabilitado])

  const cargarDocumentos = useCallback(async () => {
    const { data, error: errorDocumentos } = await supabaseClient.from('documentos').select('id, nombre, creado_en').order('creado_en', { ascending: false })
    // Sin esto, un fallo de la consulta se mostraba como «Todavía no hay
    // documentos» (MSF-699).
    if (errorDocumentos) {
      console.error('No pudimos cargar los documentos.', errorDocumentos)
      setErrorCarga(MENSAJE_CARGA)
      return
    }
    setErrorCarga(null)
    setDocumentos((data ?? []) as Documento[])
  }, [])

  useEffect(() => {
    if (habilitado) void cargarDocumentos()
  }, [habilitado, cargarDocumentos])

  const verHistorial = useCallback(async (documentoId: string) => {
    const { data } = await supabaseClient
      .from('versiones_documento')
      .select('id, estado, subida_en, motivo_error')
      .eq('documento_id', documentoId)
      .order('subida_en', { ascending: false })
    setVersionesPorDocumento((previo) => ({ ...previo, [documentoId]: (data ?? []) as VersionDocumento[] }))
  }, [])

  const subirArchivo = useCallback(async (archivo: File) => {
    if (!contexto?.organizacion_id) return
    setSubiendo(true)
    setError(null)

    // Validar antes de escribir: un archivo no admitido no crea el documento
    // ni sube nada (no queda un documento huérfano sin versión) (MSF-699).
    const problema = validarArchivoDocumento(archivo)
    if (problema) {
      setError(problema)
      setSubiendo(false)
      return
    }

    const documentoId = documentoAActualizarRef.current
    documentoAActualizarRef.current = null

    let docId = documentoId
    let documentoCreado = false
    let objetoSubido = false
    let versionRegistrada = false
    let storagePath = ''

    try {
      if (!docId) {
        const { data: nuevoDoc, error: docError } = await supabaseClient.from('documentos').insert({ nombre: archivo.name }).select('id').single()
        if (docError || !nuevoDoc) throw new Error(docError?.message ?? 'No se pudo crear el documento.')
        docId = nuevoDoc.id
        documentoCreado = true
      }

      const versionId = crypto.randomUUID()
      storagePath = `${contexto.organizacion_id}/${docId}/${versionId}`
      const { error: uploadError } = await supabaseClient.storage.from(BUCKET_DOCUMENTOS).upload(storagePath, archivo, {
        contentType: mimeDeDocumento(archivo),
        upsert: false,
      })
      if (uploadError) {
        console.error('No pudimos subir el documento.', uploadError)
        throw new Error('No pudimos subir el archivo. Revisá tu conexión e intentá de nuevo.')
      }
      objetoSubido = true

      const { error: versionError } = await supabaseClient.from('versiones_documento').insert({ id: versionId, documento_id: docId, storage_path: storagePath, estado: 'procesando' })
      if (versionError) throw new Error(versionError.message)
      versionRegistrada = true

      // El nombre del documento decide el parser del servidor (la extensión):
      // con una versión nueva, el nombre sigue al archivo realmente subido.
      if (documentoId) {
        const { error: nombreError } = await supabaseClient.from('documentos').update({ nombre: archivo.name }).eq('id', docId)
        if (nombreError) throw new Error(`No pudimos actualizar el nombre del documento: ${nombreError.message}`)
      }

      const { error: invokeError } = await supabaseClient.functions.invoke('indexar-documento', { body: { version_id: versionId } })
      if (invokeError) {
        let mensajeError = invokeError.message
        if (invokeError instanceof FunctionsHttpError) {
          const cuerpo = await invokeError.context.json().catch(() => null)
          mensajeError = cuerpo?.error ?? mensajeError
        }
        throw new Error(mensajeError)
      }

      await cargarDocumentos()
      if (docId) await verHistorial(docId)
    } catch (subidaError) {
      // Sin versión registrada no quedan ni el objeto en el bucket ni la fila
      // del documento: se deshace lo que este intento creó (MSF-699).
      if (!versionRegistrada) {
        await limpiarSubidaIncompleta(docId, documentoCreado, objetoSubido ? storagePath : null)
      }
      setError(subidaError instanceof Error ? subidaError.message : 'No se pudo subir el documento.')
    } finally {
      setSubiendo(false)
    }
  }, [contexto?.organizacion_id, cargarDocumentos, verHistorial])

  const eliminar = useCallback(async (documentoId: string) => {
    if (!window.confirm('¿Eliminar este documento? Esta acción borra el archivo y todo su contenido indexado, no se puede deshacer.')) return
    setError(null)
    const { error: rpcError } = await supabaseClient.rpc('eliminar_documento', { p_documento_id: documentoId })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await cargarDocumentos()
  }, [cargarDocumentos])

  const preguntar = useCallback(async () => {
    const texto = pregunta.trim()
    if (!texto || preguntando) return
    setPreguntando(true)
    setError(null)
    setRespuesta(null)

    const { data, error: invokeError } = await supabaseClient.functions.invoke<{ respuesta: string; documentos_citados: string[] }>(
      'preguntar-documentos',
      { body: { pregunta: texto } },
    )

    if (invokeError) {
      let mensajeError = invokeError.message
      if (invokeError instanceof FunctionsHttpError) {
        const cuerpo = await invokeError.context.json().catch(() => null)
        mensajeError = cuerpo?.error ?? mensajeError
      }
      setError(mensajeError)
    } else if (data) {
      setRespuesta({ texto: data.respuesta, citas: data.documentos_citados?.length ?? 0 })
    }
    setPreguntando(false)
  }, [pregunta, preguntando])

  if (cargandoContexto || (habilitado === null && !errorHabilitado)) return <EstadoCargaPagina />
  if (!contexto?.organizacion_id) return <Alert severity="error" sx={{ m: 2 }}>Necesitás una organización activa.</Alert>
  if (errorHabilitado) {
    return (
      <Box sx={{ m: 2 }}>
        <EstadoError titulo="No pudimos verificar la búsqueda documental." descripcion={errorHabilitado} reintentar={() => void verificarHabilitado()} />
      </Box>
    )
  }
  if (!habilitado) return <Alert severity="info" sx={{ m: 2 }}>La búsqueda documental todavía no está habilitada para tu organización — pedile a un administrador que la active en el panel de funcionalidades.</Alert>

  return (
    <List title="Documentos">
      <Stack spacing={3}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Stack direction="row" spacing={1} alignItems="center">
          <input
            ref={inputArchivoRef}
            type="file"
            accept=".txt,.pdf,.docx"
            style={{ display: 'none' }}
            onChange={(evento) => {
              const archivo = evento.target.files?.[0]
              if (archivo) void subirArchivo(archivo)
              evento.target.value = ''
            }}
          />
          <Button
            startIcon={<UploadFileIcon />}
            variant="contained"
            disabled={subiendo}
            // «Subir documento» siempre crea un documento nuevo: si el usuario
            // canceló antes el selector de «Actualizar», la referencia al
            // documento anterior ya no aplica (MSF-699).
            onClick={() => { documentoAActualizarRef.current = null; inputArchivoRef.current?.click() }}
          >
            {subiendo ? 'Subiendo...' : 'Subir documento'}
          </Button>
        </Stack>

        {errorCarga ? (
          <EstadoError titulo="No pudimos cargar los documentos." descripcion={errorCarga} reintentar={() => void cargarDocumentos()} />
        ) : documentos === null ? (
          <EstadoCargaPagina />
        ) : documentos.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay documentos" descripcion="Subí un documento para empezar a preguntarle." />
        ) : (
          <MuiList>
            {documentos.map((documento) => (
              <ListItem
                key={documento.id}
                onClick={() => void verHistorial(documento.id)}
                secondaryAction={
                  <Stack direction="row" spacing={1}>
                    <Tooltip title="Actualizar (sube una nueva versión)">
                      <IconButton size="small" onClick={() => { documentoAActualizarRef.current = documento.id; inputArchivoRef.current?.click() }}>
                        <UploadFileIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar">
                      <IconButton size="small" color="error" onClick={() => void eliminar(documento.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <ListItemText
                  primary={documento.nombre}
                  secondary={
                    versionesPorDocumento[documento.id]
                      ? versionesPorDocumento[documento.id].map((v) => `${v.estado}${v.motivo_error ? ` (${v.motivo_error})` : ''}`).join(' · ')
                      : 'Click para ver historial de versiones'
                  }
                />
              </ListItem>
            ))}
          </MuiList>
        )}

        <Box>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              placeholder="Preguntale algo a tus documentos..."
              value={pregunta}
              onChange={(evento) => setPregunta(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter') void preguntar()
              }}
              disabled={preguntando}
            />
            <Button variant="contained" onClick={() => void preguntar()} disabled={preguntando || !pregunta.trim()}>
              Preguntar
            </Button>
          </Stack>
          {respuesta && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {respuesta.texto}
              {respuesta.citas > 0 && <Chip size="small" sx={{ ml: 1 }} label={`${respuesta.citas} documento(s) citado(s)`} />}
            </Alert>
          )}
        </Box>
      </Stack>
    </List>
  )
}
