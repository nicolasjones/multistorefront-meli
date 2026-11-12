import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, FormGroup, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { TIPOS_EVENTO, useApiTabla, type Suscripcion } from './datos'

const COLUMNAS = 'id, url, tipos, activa, creada_en, actualizada_en'

/** Suscripciones a avisos salientes (FR-010, FR-014). */
export function PanelSuscripciones() {
  const { filas, hayError, recargar } = useApiTabla<Suscripcion>('api_suscripciones', COLUMNAS, 'creada_en')
  const [creando, setCreando] = useState(false)
  const [url, setUrl] = useState('')
  const [tipos, setTipos] = useState<string[]>([])
  const [secreto, setSecreto] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const errorUrl = !url.trim()
    ? 'Ingresá la URL del aviso.'
    : !/^https:\/\//i.test(url.trim())
      ? 'La URL tiene que empezar con https.'
      : null
  const errorTipos = tipos.length === 0 ? 'Elegí al menos un evento.' : null

  const cerrar = () => {
    if (guardando) return
    setCreando(false)
    setUrl('')
    setTipos([])
  }

  const crear = async () => {
    if (guardando) return
    if (errorUrl || errorTipos) return
    setGuardando(true)
    setError(null)
    const { data, error: errorRpc } = await supabaseClient
      .rpc('crear_suscripcion_api', { p_url: url.trim(), p_tipos: tipos })
      .single<{ id: string; secreto: string }>()
    setGuardando(false)
    if (errorRpc || !data) {
      setError(
        errorRpc?.code === '54000'
          ? 'Llegaste al máximo de 20 suscripciones. Eliminá alguna antes de crear otra.'
          : 'No pudimos crear la suscripción. Revisá la URL y los eventos.',
      )
      return
    }
    cerrar()
    setSecreto(data.secreto)
    recargar()
  }

  const alternar = async (suscripcion: Suscripcion) => {
    setAviso(null)
    setError(null)
    const { error: errorRpc } = await supabaseClient.rpc('actualizar_suscripcion_api', {
      p_id: suscripcion.id,
      p_activa: !suscripcion.activa,
    })
    if (errorRpc) {
      setError('No pudimos cambiar el estado de la suscripción.')
      return
    }
    recargar()
  }

  const eliminar = async (suscripcion: Suscripcion) => {
    setAviso(null)
    setError(null)
    const { error: errorRpc } = await supabaseClient.rpc('eliminar_suscripcion_api', { p_id: suscripcion.id })
    if (errorRpc) {
      setError('No pudimos eliminar la suscripción.')
      return
    }
    setAviso(`Eliminaste la suscripción ${suscripcion.url}.`)
    recargar()
  }

  const columnas: ColumnaAdaptable<Suscripcion>[] = [
    { clave: 'url', encabezado: 'URL', render: (suscripcion) => suscripcion.url },
    { clave: 'tipos', encabezado: 'Eventos', render: (suscripcion) => suscripcion.tipos.join(', ') },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (suscripcion) => (
        <EtiquetaEstado
          texto={suscripcion.activa ? 'Activa' : 'Pausada'}
          variante={suscripcion.activa ? 'exito' : 'neutral'}
        />
      ),
    },
  ]

  return (
    <Box>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" onClick={() => setCreando(true)}>Nueva suscripción</Button>
        </Stack>
        {aviso ? <Alert severity="success">{aviso}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {hayError ? (
          <EstadoError descripcion="No pudimos cargar las suscripciones." reintentar={recargar} />
        ) : filas === null ? (
          <EstadoCargaPagina />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay suscripciones." descripcion="Creá la primera con «Nueva suscripción»." />
        ) : (
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(suscripcion) => suscripcion.id}
            etiquetaTabla="Suscripciones a avisos"
            acciones={(suscripcion) => (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  aria-label={`${suscripcion.activa ? 'Pausar' : 'Reanudar'} ${suscripcion.url}`}
                  onClick={() => void alternar(suscripcion)}
                >
                  {suscripcion.activa ? 'Pausar' : 'Reanudar'}
                </Button>
                <Button size="small" color="inherit" aria-label={`Eliminar ${suscripcion.url}`} onClick={() => void eliminar(suscripcion)}>
                  Eliminar
                </Button>
              </Stack>
            )}
          />
        )}
      </Stack>

      <Dialog open={creando} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-crear-suscripcion">
        <Box component="form" onSubmit={(evento) => { evento.preventDefault(); void crear() }} noValidate>
          <TituloDialogo id="titulo-crear-suscripcion" onCerrar={cerrar}>Nueva suscripción</TituloDialogo>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="URL del aviso"
                value={url}
                onChange={(evento) => setUrl(evento.target.value)}
                required
                autoFocus
                error={Boolean(errorUrl)}
                helperText={errorUrl}
              />
              <Box>
                <Typography variant="body2" color="text.secondary">Eventos</Typography>
                <FormGroup row>
                  {TIPOS_EVENTO.map((tipo) => (
                    <FormControlLabel
                      key={tipo}
                      control={
                        <Checkbox
                          checked={tipos.includes(tipo)}
                          onChange={(evento) => setTipos((previos) =>
                            evento.target.checked
                              ? [...previos, tipo]
                              : previos.filter((otro) => otro !== tipo),
                          )}
                        />
                      }
                      label={tipo}
                    />
                  ))}
                </FormGroup>
                {errorTipos ? <Typography variant="body2" color="error">{errorTipos}</Typography> : null}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Crear'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={secreto !== null} onClose={() => setSecreto(null)} fullWidth maxWidth="sm" aria-labelledby="titulo-secreto">
        <TituloDialogo id="titulo-secreto" onCerrar={() => setSecreto(null)}>Copiá el secreto</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              El secreto firma los avisos: es la única vez que se muestra.
            </Alert>
            <TextField label="Secreto de firma" value={secreto ?? ''} InputProps={{ readOnly: true }} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { void navigator.clipboard?.writeText(secreto ?? '') }}>Copiar</Button>
          <Button variant="contained" onClick={() => setSecreto(null)}>Listo, ya lo copié</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
