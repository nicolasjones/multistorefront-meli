import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material'

const MAX_MOTIVO = 500

type Props = {
  organizacionNombre: string
  enviando: boolean
  error: string | null
  onCancelar: () => void
  onConfirmar: (motivo: string) => void
}

// Pide el motivo del acceso de soporte antes de entrar a una organización
// (F-OPS-04, FR-014/FR-018). Se monta solo mientras hay una organización elegida,
// así cada apertura arranca con el campo vacío.
export function DialogoMotivoSoporte({ organizacionNombre, enviando, error, onCancelar, onConfirmar }: Props) {
  const [motivo, setMotivo] = useState('')
  const motivoLimpio = motivo.trim()

  return (
    <Dialog open onClose={enviando ? undefined : onCancelar} fullWidth maxWidth="sm" aria-labelledby="motivo-soporte-titulo">
      <DialogTitle id="motivo-soporte-titulo">Ingresar a {organizacionNombre}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          El acceso de soporte vence solo y queda registrado en el historial de la organización, con tu nombre y este motivo.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          autoFocus
          required
          fullWidth
          multiline
          minRows={2}
          label="Motivo del acceso"
          value={motivo}
          disabled={enviando}
          onChange={(evento) => setMotivo(evento.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_MOTIVO } }}
          helperText={`${motivo.length}/${MAX_MOTIVO}`}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" disabled={enviando || motivoLimpio === ''} onClick={() => onConfirmar(motivoLimpio)}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
