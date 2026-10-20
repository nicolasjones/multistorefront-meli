import { Button, Dialog, DialogActions, DialogContent, DialogContentText } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { textoUso } from '../../lib/reparaciones'

type Props = {
  abierto: boolean
  /** «el modelo» / «el estado»: completa la frase del aviso. */
  objeto: 'modelo' | 'estado'
  /** Nombre visible del modelo o estado (no un identificador). */
  nombre: string
  cantidad: number
  onConfirmar: () => void
  onCancelar: () => void
}

// Aviso al desactivar un modelo o estado que ya usan reparaciones (FR-019). Desactivar no altera esas
// reparaciones: solo deja de ofrecerse en altas nuevas, y el aviso lo dice con la cantidad.
export function ConfirmarDesactivarDialog({ abierto, objeto, nombre, cantidad, onConfirmar, onCancelar }: Props) {
  return (
    <Dialog open={abierto} onClose={onCancelar} fullWidth maxWidth="xs" aria-labelledby="titulo-confirmar-desactivar">
      <TituloDialogo id="titulo-confirmar-desactivar" onCerrar={onCancelar}>
        {`¿Desactivar ${objeto === 'modelo' ? 'el modelo' : 'el estado'}?`}
      </TituloDialogo>
      <DialogContent>
        <DialogContentText>
          {`«${nombre}» está en uso en ${textoUso(cantidad)}. Esas reparaciones no cambian, pero ${
            objeto === 'modelo' ? 'el modelo' : 'el estado'
          } deja de ofrecerse en las altas nuevas.`}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar}>Cancelar</Button>
        <Button variant="contained" onClick={onConfirmar}>Desactivar</Button>
      </DialogActions>
    </Dialog>
  )
}
