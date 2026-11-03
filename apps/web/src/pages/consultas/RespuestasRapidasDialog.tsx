import { type FormEvent, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Divider, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useRespuestasRapidas } from '../../hooks/useRespuestasRapidas'
import {
  TEXTO_RESPUESTA_MAXIMO,
  TITULO_RESPUESTA_MAXIMO,
  VARIABLES_RESPUESTA,
  eliminarRespuestaRapida,
  guardarRespuestaRapida,
  mensajeDeErrorRespuesta,
  type RespuestaRapida,
} from '../../lib/respuestasRapidas'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'

type Props = {
  /** Empresa activa (barra superior / filtro de la pantalla). null = «todas»: hay que elegir una tienda. */
  empresaId: string | null
  empresaNombre: string | null
  /** `consultas` = edición. Con lectura se ve la lista sin poder cambiarla. */
  puedeEditar: boolean
  onCerrar: () => void
}

type Edicion = { id: string | null; titulo: string; texto: string }

// Diálogo `Respuestas rápidas` (F-CON-06, FR-014): lista de textos de la empresa activa con crear, editar
// y eliminar. Los textos solo arman el texto inicial de «Responder»: no envían nada. El diálogo se monta
// por empresa (`key`) desde la pantalla, que lo cierra con aviso si la empresa activa cambia (FR-018).
export function RespuestasRapidasDialog({ empresaId, empresaNombre, puedeEditar, onCerrar }: Props) {
  const { respuestas, isLoading, isError, refetch } = useRespuestasRapidas(empresaId)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [pendienteEliminar, setPendienteEliminar] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)

  const ejecutar = async (accion: () => Promise<void>, mensajeError: string) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setOcupado(true)
    setError(null)
    try {
      await accion()
      await refetch()
    } catch (falla) {
      setError(mensajeDeErrorRespuesta(falla, mensajeError))
    } finally {
      enVuelo.current = false
      setOcupado(false)
    }
  }

  const guardar = (evento: FormEvent) => {
    evento.preventDefault()
    if (!edicion || !empresaId || !puedeEditar) return
    const actual = edicion
    void ejecutar(async () => {
      await guardarRespuestaRapida({ id: actual.id, empresaId, titulo: actual.titulo, texto: actual.texto })
      setEdicion(null)
    }, 'No pudimos guardar la respuesta rápida. Intentá de nuevo.')
  }

  const eliminar = (respuesta: RespuestaRapida) => {
    if (!puedeEditar) return
    void ejecutar(async () => {
      await eliminarRespuestaRapida(respuesta.id)
      setPendienteEliminar(null)
    }, 'No pudimos eliminar la respuesta rápida. Intentá de nuevo.')
  }

  const formularioValido = edicion !== null && edicion.titulo.trim() !== '' && edicion.texto.trim() !== ''

  return (
    <Dialog open onClose={ocupado ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-respuestas-rapidas">
      <TituloDialogo id="titulo-respuestas-rapidas" onCerrar={ocupado ? undefined : onCerrar}>
        Respuestas rápidas{empresaNombre ? ` · ${empresaNombre}` : ''}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="s">
            Textos de siempre para responder consultas. Al responder, el texto elegido se abre en WhatsApp o en el correo; el panel no envía nada.
            Variables: {VARIABLES_RESPUESTA.join(', ')} (se reemplazan con los datos de la consulta).
          </Typography>
          {puedeEditar ? null : (
            <Typography variant="xs" role="note">Solo lectura: tu rol puede ver las respuestas rápidas pero no cambiarlas.</Typography>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}

          {empresaId === null ? (
            <Alert severity="info">Elegí una tienda en la barra superior para ver y gestionar sus respuestas rápidas.</Alert>
          ) : isLoading ? (
            <EstadoCargaPagina />
          ) : isError ? (
            <EstadoError descripcion="No pudimos cargar las respuestas rápidas." reintentar={() => void refetch()} />
          ) : (
            <>
              {respuestas.length === 0 && edicion === null ? (
                <EstadoVacio
                  titulo="Todavía no hay respuestas rápidas."
                  descripcion={puedeEditar
                    ? 'Creá la primera para reutilizar un texto al responder consultas de esta empresa.'
                    : 'Cuando alguien con permiso de edición cree una, aparece acá.'}
                />
              ) : null}
              <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Respuestas rápidas">
                {respuestas.map((respuesta) => (
                  <Box component="li" key={respuesta.id} sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => tema.shape.borderRadius, p: 1.5 }}>
                    <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{respuesta.titulo}</Typography>
                    {/* Texto plano (React lo escapa) con sus saltos de línea. */}
                    <Typography variant="s" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{respuesta.texto}</Typography>
                    {puedeEditar ? (
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
                        {pendienteEliminar === respuesta.id ? (
                          <>
                            <Typography variant="xs">¿Eliminar «{respuesta.titulo}»?</Typography>
                            <Button size="small" color="error" disabled={ocupado} onClick={() => eliminar(respuesta)}>
                              Sí, eliminar
                            </Button>
                            <Button size="small" disabled={ocupado} onClick={() => setPendienteEliminar(null)}>No</Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="small"
                              disabled={ocupado}
                              aria-label={`Editar ${respuesta.titulo}`}
                              onClick={() => setEdicion({ id: respuesta.id, titulo: respuesta.titulo, texto: respuesta.texto })}
                            >
                              Editar
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              disabled={ocupado}
                              aria-label={`Eliminar ${respuesta.titulo}`}
                              onClick={() => setPendienteEliminar(respuesta.id)}
                            >
                              Eliminar
                            </Button>
                          </>
                        )}
                      </Stack>
                    ) : null}
                  </Box>
                ))}
              </Stack>

              {edicion ? (
                <>
                  <Divider />
                  <Stack component="form" spacing={2} onSubmit={guardar} noValidate aria-label={edicion.id ? 'Editar respuesta rápida' : 'Nueva respuesta rápida'}>
                    <TextField
                      label="Título"
                      size="small"
                      value={edicion.titulo}
                      onChange={(evento) => setEdicion({ ...edicion, titulo: evento.target.value })}
                      disabled={ocupado}
                      required
                      slotProps={{ htmlInput: { maxLength: TITULO_RESPUESTA_MAXIMO } }}
                    />
                    <TextField
                      label="Texto"
                      size="small"
                      multiline
                      minRows={3}
                      value={edicion.texto}
                      onChange={(evento) => setEdicion({ ...edicion, texto: evento.target.value })}
                      disabled={ocupado}
                      required
                      slotProps={{ htmlInput: { maxLength: TEXTO_RESPUESTA_MAXIMO } }}
                      helperText={`${edicion.texto.length}/${TEXTO_RESPUESTA_MAXIMO}`}
                    />
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button disabled={ocupado} onClick={() => setEdicion(null)}>Cancelar</Button>
                      <Button type="submit" variant="contained" disabled={ocupado || !formularioValido}>
                        {ocupado ? 'Guardando…' : 'Guardar'}
                      </Button>
                    </Stack>
                  </Stack>
                </>
              ) : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={ocupado}>Cerrar</Button>
        {empresaId !== null && edicion === null ? (
          <Tooltip title={puedeEditar ? '' : 'Necesitás permiso de edición'}>
            <span>
              <Button
                variant="contained"
                disabled={!puedeEditar || ocupado}
                onClick={() => setEdicion({ id: null, titulo: '', texto: '' })}
              >
                Nueva respuesta
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
