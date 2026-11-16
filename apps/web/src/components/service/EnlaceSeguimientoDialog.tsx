import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { mensajeDeErrorEnlace, obtenerEnlaceConsulta, regenerarEnlaceConsulta, urlEnlaceSeguimiento } from '../../lib/enlaceConsulta'

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
  const [confirmando, setConfirmando] = useState(false)
  const [regenerado, setRegenerado] = useState(false)
  // Qué reintenta «Reintentar»: obtener el enlace o la regeneración que falló.
  const [fallo, setFallo] = useState<'cargar' | 'regenerar'>('cargar')
  const enVuelo = useRef(false)
  const botonRegenerar = useRef<HTMLButtonElement>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    setFallo('cargar')
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
    setConfirmando(false)
    setRegenerado(false)
    void cargar()
  }, [abierto, cargar])

  const volverAlBoton = () => setTimeout(() => botonRegenerar.current?.focus(), 0)

  const cancelarConfirmacion = () => {
    setConfirmando(false)
    volverAlBoton()
  }

  const regenerar = async () => {
    // Doble clic: una sola regeneración en vuelo (cada llamada vence el token de la anterior).
    if (cargando || enVuelo.current) return
    enVuelo.current = true
    setCargando(true)
    setError(null)
    setRegenerado(false)
    setFallo('regenerar')
    try {
      setUrl(urlEnlaceSeguimiento(window.location.origin, await regenerarEnlaceConsulta(reparacionId)))
      setRegenerado(true)
      setCopiado(false)
      setFallo('cargar')
    } catch (falla) {
      setError(mensajeDeErrorEnlace(falla, 'No pudimos regenerar el enlace de seguimiento.'))
    } finally {
      enVuelo.current = false
      setCargando(false)
      setConfirmando(false)
      volverAlBoton()
    }
  }

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
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void (fallo === 'regenerar' ? regenerar() : cargar())}>Reintentar</Button>}>{error}</Alert>
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
          {regenerado ? <Alert severity="success">Enlace regenerado: el anterior dejó de funcionar.</Alert> : null}
          {confirmando ? (
            <Alert
              severity="warning"
              action={
                <>
                  <Button color="inherit" size="small" autoFocus onClick={cancelarConfirmacion}>Cancelar</Button>
                  <Button color="inherit" size="small" disabled={cargando} onClick={() => void regenerar()}>Sí, regenerar</Button>
                </>
              }
            >
              ¿Regenerar el enlace? El enlace anterior dejará de funcionar y tendrás que mandarle el nuevo al cliente.
            </Alert>
          ) : null}
          {copiado ? <Alert severity="success">Enlace copiado</Alert> : null}
          {errorCopia ? <Alert severity="warning">No pudimos copiarlo automáticamente: seleccionalo y copialo a mano.</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
        <Button ref={botonRegenerar} color="warning" onClick={() => setConfirmando(true)} disabled={!url || cargando}>Regenerar enlace</Button>
        <Button variant="contained" onClick={() => void copiar()} disabled={!url || cargando}>Copiar enlace</Button>
      </DialogActions>
    </Dialog>
  )
}
