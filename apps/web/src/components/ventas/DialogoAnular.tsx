import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import {
  MOTIVO_ANULACION_MAXIMO,
  TITULO_ANULAR,
  anularComprobante,
  esConflictoDeAnulacion,
  mensajeDeAnulacion,
  validarMotivoAnulacion,
} from '../../lib/anularComprobante'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  comprobante: { id: string; numero: string; updated_at: string }
  onCerrar: () => void
  // La base anuló (o ya estaba anulada): la pantalla relee el comprobante, que pasa a solo lectura.
  onAnulada: () => void
  // Otra persona cambió el comprobante: la pantalla lo relee antes de que se reintente.
  onConflicto: () => void
}

// Diálogo «Anular factura» (F-VTA-11, FR-042). Pide el motivo (obligatorio) y la confirmación antes de revertir el
// stock; muestra el error sin cerrarse. La base vuelve a verificar todo: lo que se ve acá es un adelanto.
export function DialogoAnular({ open, comprobante, onCerrar, onAnulada, onConflicto }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-anular-factura">
      {/* El contenido se monta al abrir: cada apertura parte sin motivo ni errores previos. */}
      <Contenido comprobante={comprobante} onCerrar={onCerrar} onAnulada={onAnulada} onConflicto={onConflicto} />
    </Dialog>
  )
}

function Contenido({ comprobante, onCerrar, onAnulada, onConflicto }: Omit<Props, 'open'>) {
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [anulando, setAnulando] = useState(false)

  const anular = async () => {
    if (anulando) return
    const invalido = validarMotivoAnulacion(motivo)
    setErrorMotivo(invalido)
    if (invalido) return
    setAnulando(true)
    setError(null)
    try {
      await anularComprobante(comprobante.id, motivo, comprobante.updated_at)
      onAnulada()
    } catch (falla) {
      setError(mensajeDeAnulacion(falla))
      if (esConflictoDeAnulacion(falla)) onConflicto()
      setAnulando(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-anular-factura" onCerrar={anulando ? undefined : onCerrar}>
        {TITULO_ANULAR} {comprobante.numero}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            Anular corrige una factura emitida por error: deja de valer, el stock vuelve a cada depósito de origen y se liberan
            las reservas «A pedido». El número no se reutiliza y queda registrado quién la anuló y por qué. No se puede deshacer.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Si el cliente devolvió mercadería o necesitás un ajuste, emití una nota de crédito en lugar de anular.
          </Typography>
          <TextField
            label="Motivo de la anulación"
            required
            multiline
            minRows={2}
            fullWidth
            autoFocus
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value)
              setErrorMotivo(null)
            }}
            disabled={anulando}
            error={Boolean(errorMotivo)}
            helperText={errorMotivo ?? `${motivo.trim().length} / ${MOTIVO_ANULACION_MAXIMO}`}
            slotProps={{ htmlInput: { maxLength: MOTIVO_ANULACION_MAXIMO + 50 } }}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={anulando}>Cancelar</Button>
        <Button variant="contained" color="error" onClick={() => void anular()} disabled={anulando}>
          {anulando ? 'Anulando…' : TITULO_ANULAR}
        </Button>
      </DialogActions>
    </>
  )
}
