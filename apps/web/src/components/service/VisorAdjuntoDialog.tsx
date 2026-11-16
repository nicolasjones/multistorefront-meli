import { useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import type { Adjunto } from '../../lib/reparacionAdjuntos'

type Props = {
  adjunto: Adjunto | null
  url: string | undefined
  // Quitar solo con `edicion` y la reparación no anulada.
  puedeQuitar: boolean
  quitando: boolean
  error: string | null
  onCerrar: () => void
  onQuitar: (adjunto: Adjunto) => void
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// Vista ampliada de un adjunto (FR-007): nombre, fecha y quién lo subió; quitar con confirmación.
export function VisorAdjuntoDialog({ adjunto, url, puedeQuitar, quitando, error, onCerrar, onQuitar }: Props) {
  const [confirmando, setConfirmando] = useState(false)
  const cerrar = () => {
    setConfirmando(false)
    onCerrar()
  }
  return (
    <Dialog open={adjunto !== null} onClose={cerrar} fullWidth maxWidth="md" aria-labelledby="visor-adjunto-titulo">
      <TituloDialogo id="visor-adjunto-titulo" onCerrar={cerrar}>{adjunto?.nombre_original ?? ''}</TituloDialogo>
      <DialogContent>
        <Stack spacing={1.5}>
          {url && adjunto ? (
            <Box
              component="img"
              src={url}
              alt={adjunto.nombre_original}
              sx={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', bgcolor: 'action.hover', borderRadius: 1 }}
            />
          ) : (
            <Alert severity="warning">No pudimos cargar la foto. Cerrá este cuadro y reintentá.</Alert>
          )}
          {adjunto ? (
            <Typography variant="body2" color="text.secondary">
              <time dateTime={adjunto.creado_en}>{formatoFecha.format(new Date(adjunto.creado_en))}</time>
              {` · Subida por ${adjunto.subido_por}`}
            </Typography>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {confirmando ? <Alert severity="warning">¿Quitar esta foto? Dejará de estar disponible.</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {puedeQuitar && adjunto ? (
          confirmando ? (
            <>
              <Button onClick={() => setConfirmando(false)} disabled={quitando}>Cancelar</Button>
              <Button color="error" variant="contained" onClick={() => onQuitar(adjunto)} disabled={quitando}>
                {quitando ? 'Quitando…' : 'Quitar foto'}
              </Button>
            </>
          ) : (
            <Button color="error" onClick={() => setConfirmando(true)}>Quitar</Button>
          )
        ) : null}
        {!confirmando ? <Button onClick={cerrar}>Cerrar</Button> : null}
      </DialogActions>
    </Dialog>
  )
}
