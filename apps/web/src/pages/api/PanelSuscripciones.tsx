import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, FormGroup, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { TIPOS_EVENTO, useApiTabla, type Suscripcion } from './datos'

const COLUMNAS = 'id, url, tipos, activa, creada_en, actualizada_en, secreto_anterior_vence_en'

/** La gracia de una rotación sigue en curso si el secreto anterior todavía vale. */
const graciaVigente = (suscripcion: Suscripcion) =>
  suscripcion.secreto_anterior_vence_en !== null && new Date(suscripcion.secreto_anterior_vence_en).getTime() > Date.now()

/** Suscripciones a avisos salientes (FR-010, FR-014). */
export function PanelSuscripciones() {
  const { filas, hayError, recargar } = useApiTabla<Suscripcion>('api_suscripciones', COLUMNAS, 'creada_en')
  const [creando, setCreando] = useState(false)
  const [url, setUrl] = useState('')
  const [tipos, setTipos] = useState<string[]>([])
  const [secreto, setSecreto] = useState<string | null>(null)
  const [secretoRotado, setSecretoRotado] = useState(false)
  const [rotando, setRotando] = useState<Suscripcion | null>(null)
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
    setSecretoRotado(false)
    setSecreto(data.secreto)
    recargar()
  }

  // Rotar el secreto de firma (MSF-839): el nuevo se muestra una sola vez y el anterior sigue valiendo 24 horas.
  const rotar = async () => {
    if (!rotando || guardando) return
    setGuardando(true)
    const { data, error: errorRpc } = await supabaseClient
      .rpc('rotar_secreto_suscripcion_api', { p_id: rotando.id })
      .single<{ id: string; secreto: string }>()
    setGuardando(false)
    if (errorRpc || !data) {
      setRotando(null)
      setError('No pudimos rotar el secreto de la suscripción.')
      return
    }
    setRotando(null)
    setSecretoRotado(true)
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
    {
      clave: 'secreto',
      encabezado: 'Secreto de firma',
      render: (suscripcion) =>
        graciaVigente(suscripcion)
          ? `Rotado: el anterior vale hasta ${new Date(suscripcion.secreto_anterior_vence_en as string).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`
          : '—',
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
                <Button size="small" aria-label={`Rotar secreto de ${suscripcion.url}`} onClick={() => { setError(null); setAviso(null); setRotando(suscripcion) }}>
                  Rotar secreto
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

      <Dialog open={rotando !== null} onClose={() => { if (!guardando) setRotando(null) }} fullWidth maxWidth="xs" aria-labelledby="titulo-rotar-secreto">
        <TituloDialogo id="titulo-rotar-secreto" onCerrar={() => { if (!guardando) setRotando(null) }}>Rotar secreto</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              Se crea un secreto nuevo para {rotando?.url}. El anterior sigue valiendo 24 horas: durante ese tiempo cada aviso lleva las dos firmas, así podés cambiarlo en el otro sistema sin cortar el servicio.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Si ya habías rotado hace poco, el secreto anterior de esa rotación deja de valer ahora.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRotando(null)} disabled={guardando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void rotar()} disabled={guardando}>
            {guardando ? 'Rotando…' : 'Rotar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={secreto !== null} onClose={() => setSecreto(null)} fullWidth maxWidth="sm" aria-labelledby="titulo-secreto">
        <TituloDialogo id="titulo-secreto" onCerrar={() => setSecreto(null)}>Copiá el secreto</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              El secreto firma los avisos: es la única vez que se muestra.
              {secretoRotado ? ' El anterior sigue valiendo 24 horas: cambialo en el otro sistema antes de que venza.' : ''}
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
