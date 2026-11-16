import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { etiquetaFuncionalidad, mensajeCancelacion, type ProcesoMasivo } from '../../lib/procesosMasivos'

type Props = {
  proceso: ProcesoMasivo
  onCerrar: () => void
  // Se llama después de cancelar o de enterarnos de que ya terminó, para releer la tabla.
  onResuelto: (resultado: 'cancelado' | 'cancelacion_solicitada' | 'terminado') => void
}

// Confirmación de «Cancelar» (FR-014). Si el proceso terminó mientras tanto, lo dice con claridad.
export function CancelarProceso({ proceso, onCerrar, onResuelto }: Props) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmar = async () => {
    setEnviando(true)
    setError(null)
    const { data, error: fallo } = await supabaseClient.rpc('solicitar_cancelacion_proceso_masivo', { p_proceso_id: proceso.id })
    setEnviando(false)
    if (fallo) {
      setError(mensajeCancelacion(fallo))
      if (fallo.message?.includes('PROCESO_TERMINADO')) onResuelto('terminado')
      return
    }
    onResuelto(data === 'cancelado' ? 'cancelado' : 'cancelacion_solicitada')
  }

  return (
    <Dialog open onClose={enviando ? undefined : onCerrar} aria-labelledby="cancelar-proceso-titulo">
      <DialogTitle id="cancelar-proceso-titulo">¿Cancelar este proceso?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Vas a cancelar «{proceso.nombre}» ({etiquetaFuncionalidad(proceso.funcionalidad)}). Lo que ya se procesó se conserva.
        </DialogContentText>
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>No, volver</Button>
        <Button color="error" variant="contained" onClick={() => void confirmar()} disabled={enviando}>Sí, cancelar el proceso</Button>
      </DialogActions>
    </Dialog>
  )
}
