import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { mensajeDeErrorEnlace, obtenerEnlaceConsulta, urlEnlaceSeguimiento } from '../../lib/enlaceConsulta'

type Props = {
  abierto: boolean
  reparacionId: string
  codigo: string
  onCerrar: () => void
}

// Enlace de seguimiento (FR-046): URL pública de la reparación y «Copiar enlace». No envía ningún mensaje al
// cliente. Pedirlo de nuevo muestra el mismo enlace (la base es idempotente).
export function EnlaceSeguimientoDialog({ abierto, reparacionId, codigo, onCerrar }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [errorCopia, setErrorCopia] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setUrl(urlEnlaceSeguimiento(window.location.origin, await obtenerEnlaceConsulta(reparacionId)))
    } catch (falla) {
      setUrl(null)
      setError(mensajeDeErrorEnlace(falla, 'No pudimos obtener el enlace de seguimiento.'))
    } finally {
      setCargando(false)
    }
  }, [reparacionId])

  useEffect(() => {
    if (!abierto) return
    setCopiado(false)
    setErrorCopia(false)
    void cargar()
  }, [abierto, cargar])

  const copiar = async () => {
    if (!url) return
    setErrorCopia(false)
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
    } catch (falla) {
      console.error('No se pudo copiar el enlace de seguimiento.', falla)
      setCopiado(false)
      setErrorCopia(true)
    }
  }

  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-enlace-seguimiento">
      <TituloDialogo id="titulo-enlace-seguimiento" onCerrar={onCerrar}>{`Enlace de seguimiento · ${codigo}`}</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Quien tenga este enlace puede ver el estado de la reparación, sin iniciar sesión. No se envía ningún mensaje al cliente: copialo y mandáselo vos.
          </Typography>
          {error ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>{error}</Alert>
          ) : null}
          {cargando ? <Typography role="status" variant="body2">Obteniendo el enlace…</Typography> : null}
          {url ? (
            <TextField
              label="Enlace para el cliente"
              value={url}
              fullWidth
              onFocus={(evento) => evento.target.select()}
              slotProps={{ input: { readOnly: true } }}
            />
          ) : null}
          {copiado ? <Alert severity="success">Enlace copiado</Alert> : null}
          {errorCopia ? <Alert severity="warning">No pudimos copiarlo automáticamente: seleccionalo y copialo a mano.</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
        <Button variant="contained" onClick={() => void copiar()} disabled={!url || cargando}>Copiar enlace</Button>
      </DialogActions>
    </Dialog>
  )
}
