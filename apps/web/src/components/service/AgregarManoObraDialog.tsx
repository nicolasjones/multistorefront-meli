import { TextField } from '@mui/material'
import { LARGO_MAXIMO_DESCRIPCION_ITEM } from '../../lib/reparacionItems'
import type { Reparacion } from '../../lib/reparaciones'
import { AgregarItemDialog } from './AgregarItemDialog'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  onCerrar: () => void
  onAgregada: (reparacion: Reparacion) => void
}

// «Agregar mano de obra» (F-SVC-06, FR-028). El concepto es texto libre (el catálogo de servicios del prototipo
// queda fuera de alcance: spec «Decisiones abiertas» 4) y el precio se tipea.
export function AgregarManoObraDialog(props: Props) {
  return (
    <AgregarItemDialog
      {...props}
      tipo="mano_obra"
      titulo="Agregar mano de obra"
      renderConcepto={({ formulario, cambiar, errores, deshabilitado }) => (
        <TextField
          label="Concepto"
          required
          autoFocus
          fullWidth
          value={formulario.descripcion}
          onChange={(evento) => cambiar({ descripcion: evento.target.value })}
          disabled={deshabilitado}
          error={Boolean(errores.descripcion)}
          helperText={errores.descripcion}
          slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_DESCRIPCION_ITEM } }}
        />
      )}
    />
  )
}
