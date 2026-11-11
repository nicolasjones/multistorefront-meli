import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, FormGroup, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { ALCANCES, useApiTabla, type Clave } from './datos'

const COLUMNAS = 'id, nombre, prefijo, alcances, limite_por_minuto, creada_en, vence_en, revocada_en, ultimo_uso_en'

const estadoDe = (clave: Clave): { texto: string; variante: 'exito' | 'aviso' | 'error' | 'neutral' } => {
  if (clave.revocada_en) return { texto: 'Revocada', variante: 'error' }
  if (clave.vence_en && new Date(clave.vence_en) <= new Date()) return { texto: 'Vencida', variante: 'aviso' }
  return { texto: 'Activa', variante: 'exito' }
}

const fecha = (valor: string | null) => (valor ? new Date(valor).toLocaleString() : '—')

/** Claves de API de la organización (FR-001, FR-002, FR-013). */
export function PanelClaves() {
  const { filas, hayError, recargar } = useApiTabla<Clave>('api_claves', COLUMNAS, 'creada_en')
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [alcances, setAlcances] = useState<string[]>([])
  const [vence, setVence] = useState('')
  const [valor, setValor] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorCrear, setErrorCrear] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<{ tipo: 'rotar' | 'revocar'; clave: Clave } | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [accionando, setAccionando] = useState(false)

  const cerrar = () => {
    if (guardando) return
    setCreando(false)
    setNombre('')
    setAlcances([])
    setVence('')
    setErrorCrear(null)
  }

  const cerrarConfirmacion = () => {
    if (accionando) return
    setConfirmacion(null)
    setErrorAccion(null)
  }

  const errorNombre = !nombre.trim() ? 'Ingresá un nombre.' : null
  const errorAlcances = alcances.length === 0 ? 'Elegí al menos un alcance.' : null

  const crear = async () => {
    if (guardando) return
    if (errorNombre || errorAlcances) return
    setGuardando(true)
    setErrorCrear(null)
    const { data, error: errorRpc } = await supabaseClient
      .rpc('crear_clave_api', {
        p_nombre: nombre.trim(),
        p_alcances: alcances,
        p_vence_en: vence ? new Date(vence).toISOString() : null,
      })
      .single<{ id: string; valor: string }>()
    setGuardando(false)
    if (errorRpc || !data) {
      setErrorCrear('No pudimos crear la clave.')
      return
    }
    cerrar()
    setValor(data.valor)
    recargar()
  }

  const pedirConfirmacion = (tipo: 'rotar' | 'revocar', clave: Clave) => {
    setAviso(null)
    setErrorAccion(null)
    setConfirmacion({ tipo, clave })
  }

  const confirmar = async () => {
    if (!confirmacion || accionando) return
    const { tipo, clave } = confirmacion
    setAccionando(true)
    setErrorAccion(null)
    if (tipo === 'rotar') {
      const { data, error: errorRpc } = await supabaseClient
        .rpc('rotar_clave_api', { p_clave_id: clave.id })
        .single<{ id: string; valor: string }>()
      setAccionando(false)
      if (errorRpc || !data) {
        setErrorAccion('No pudimos rotar la clave.')
        return
      }
      setConfirmacion(null)
      setValor(data.valor)
      recargar()
      return
    }
    const { error: errorRpc } = await supabaseClient.rpc('revocar_clave_api', { p_clave_id: clave.id })
    setAccionando(false)
    if (errorRpc) {
      setErrorAccion('No pudimos revocar la clave.')
      return
    }
    setConfirmacion(null)
    setAviso(`Revocaste la clave ${clave.nombre}.`)
    recargar()
  }

  const columnas: ColumnaAdaptable<Clave>[] = [
    { clave: 'nombre', encabezado: 'Nombre', render: (clave) => <Typography variant="b">{clave.nombre}</Typography> },
    { clave: 'prefijo', encabezado: 'Prefijo', render: (clave) => <code>{clave.prefijo}</code> },
    { clave: 'alcances', encabezado: 'Alcances', render: (clave) => clave.alcances.join(', ') },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (clave) => {
        const estado = estadoDe(clave)
        return <EtiquetaEstado texto={estado.texto} variante={estado.variante} />
      },
    },
    { clave: 'ultimo_uso', encabezado: 'Último uso', render: (clave) => fecha(clave.ultimo_uso_en) },
    { clave: 'vence', encabezado: 'Vence', render: (clave) => fecha(clave.vence_en) },
  ]

  return (
    <Box>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" onClick={() => { setErrorCrear(null); setCreando(true) }}>Crear clave</Button>
        </Stack>
        {aviso ? <Alert severity="success">{aviso}</Alert> : null}
        {hayError ? (
          <EstadoError descripcion="No pudimos cargar las claves." reintentar={recargar} />
        ) : filas === null ? (
          <EstadoCargaPagina />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay claves." descripcion="Creá la primera con «Crear clave»." />
        ) : (
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(clave) => clave.id}
            etiquetaTabla="Claves de API"
            acciones={(clave) => (
              <Stack direction="row" spacing={1}>
                <Button size="small" aria-label={`Rotar ${clave.nombre}`} onClick={() => pedirConfirmacion('rotar', clave)}>
                  Rotar
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  aria-label={`Revocar ${clave.nombre}`}
                  disabled={Boolean(clave.revocada_en)}
                  onClick={() => pedirConfirmacion('revocar', clave)}
                >
                  Revocar
                </Button>
              </Stack>
            )}
          />
        )}
      </Stack>

      <Dialog open={creando} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-crear-clave">
        <Box component="form" onSubmit={(evento) => { evento.preventDefault(); void crear() }} noValidate>
          <TituloDialogo id="titulo-crear-clave" onCerrar={cerrar}>Crear clave</TituloDialogo>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                required
                autoFocus
                error={Boolean(errorNombre)}
                helperText={errorNombre}
              />
              <Box>
                <Typography variant="body2" color="text.secondary">Alcances de lectura</Typography>
                <FormGroup row>
                  {ALCANCES.map((alcance) => (
                    <FormControlLabel
                      key={alcance}
                      control={
                        <Checkbox
                          checked={alcances.includes(alcance)}
                          onChange={(evento) => setAlcances((previas) =>
                            evento.target.checked
                              ? [...previas, alcance]
                              : previas.filter((otro) => otro !== alcance),
                          )}
                        />
                      }
                      label={alcance}
                    />
                  ))}
                </FormGroup>
                {errorAlcances ? <Typography variant="body2" color="error">{errorAlcances}</Typography> : null}
              </Box>
              <TextField
                label="Vencimiento (opcional)"
                type="date"
                value={vence}
                onChange={(evento) => setVence(evento.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              {errorCrear ? <Alert severity="error">{errorCrear}</Alert> : null}
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

      <Dialog
        open={confirmacion !== null}
        onClose={cerrarConfirmacion}
        fullWidth
        maxWidth="xs"
        aria-labelledby="titulo-confirmar-clave"
      >
        <TituloDialogo id="titulo-confirmar-clave" onCerrar={cerrarConfirmacion}>
          {confirmacion?.tipo === 'revocar' ? 'Revocar clave' : 'Rotar clave'}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              {confirmacion?.tipo === 'revocar'
                ? `«${confirmacion.clave.nombre}» deja de funcionar en la llamada siguiente. No se puede deshacer.`
                : `Se genera una clave nueva para «${confirmacion?.clave.nombre}» y la anterior sigue válida 24 h.`}
            </Typography>
            {errorAccion ? <Alert severity="error">{errorAccion}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrarConfirmacion} disabled={accionando}>Cancelar</Button>
          <Button
            variant="contained"
            color={confirmacion?.tipo === 'revocar' ? 'error' : 'primary'}
            onClick={() => void confirmar()}
            disabled={accionando}
          >
            {accionando ? 'Guardando…' : confirmacion?.tipo === 'revocar' ? 'Revocar' : 'Rotar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={valor !== null} onClose={() => setValor(null)} fullWidth maxWidth="sm" aria-labelledby="titulo-valor-clave">
        <TituloDialogo id="titulo-valor-clave" onCerrar={() => setValor(null)}>Copiá la clave</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              Esta es la única vez que se muestra la clave: después solo queda su hash.
            </Alert>
            <TextField label="Clave de API" value={valor ?? ''} InputProps={{ readOnly: true }} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { void navigator.clipboard?.writeText(valor ?? '') }}>Copiar</Button>
          <Button variant="contained" onClick={() => setValor(null)}>Listo, ya la copié</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
