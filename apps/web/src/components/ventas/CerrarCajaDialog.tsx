import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { mensajeDeErrorCierreCaja } from '../../lib/cierreCaja'

type Props = {
  open: boolean
  accion: 'cerrar' | 'reabrir'
  empresa: string
  // Fecha legible del día que se cierra o reabre.
  fecha: string
  onCerrar: () => void
  // Ejecuta la RPC; si falla, el diálogo muestra el error sin cerrarse.
  onConfirmar: () => Promise<void>
}

// Confirmación de «Cerrar caja» y «Reabrir» (F-VTA-33, FR-024). La base vuelve a verificar el rol.
export function CerrarCajaDialog({ open, accion, empresa, fecha, onCerrar, onConfirmar }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-cierre-caja">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido accion={accion} empresa={empresa} fecha={fecha} onCerrar={onCerrar} onConfirmar={onConfirmar} />
    </Dialog>
  )
}

function Contenido({ accion, empresa, fecha, onCerrar, onConfirmar }: Omit<Props, 'open'>) {
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cerrando = accion === 'cerrar'

  const confirmar = async () => {
    if (enCurso) return
    setEnCurso(true)
    setError(null)
    try {
      await onConfirmar()
    } catch (falla) {
      setError(mensajeDeErrorCierreCaja(
        falla,
        cerrando ? 'No pudimos cerrar la caja. Intentá de nuevo.' : 'No pudimos reabrir la caja. Intentá de nuevo.',
      ))
      setEnCurso(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-cierre-caja" onCerrar={enCurso ? undefined : onCerrar}>
        {cerrando ? 'Cerrar caja' : 'Reabrir caja'}
      </TituloDialogo>
      <DialogContent>
        <Typography variant="body2">
          {cerrando
            ? `Vas a cerrar la caja de ${empresa} del ${fecha}. Se resumen los cobros del día por forma de pago y cuenta, y no se podrán registrar ni modificar cobros de ese día hasta reabrirla.`
            : `Vas a reabrir la caja de ${empresa} del ${fecha}. Se podrán registrar y modificar cobros de ese día; al volver a cerrarla se rehace el resumen.`}
        </Typography>
        {error ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enCurso}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enCurso}>
          {cerrando ? 'Cerrar caja' : 'Reabrir'}
        </Button>
      </DialogActions>
    </>
  )
}
