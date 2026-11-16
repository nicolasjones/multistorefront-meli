import { MenuItem, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { DepositoOpcion } from '../../lib/depositos'

type Props = {
  depositos: readonly DepositoOpcion[]
  valor: string
  onCambio: (depositoId: string) => void
  /** Texto accesible: a qué línea pertenece el selector. */
  etiqueta: string
  disabled?: boolean
}

const MAXIMO_EN_BOTONES = 3

// Depósito de mercadería de una línea (FR-013). El prototipo lo muestra como botones «Local» / «Principal»;
// con más depósitos (MSF-292) que los que caben en botones pasa a una lista. El valor por defecto de una línea
// nueva (el principal de la organización) lo fija la base cuando no se elige uno.
export function DepositoSelect({ depositos, valor, onCambio, etiqueta, disabled = false }: Props) {
  if (depositos.length <= MAXIMO_EN_BOTONES) {
    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        fullWidth
        disabled={disabled}
        value={valor}
        aria-label={etiqueta}
        onChange={(_evento, nuevo: string | null) => {
          if (nuevo && nuevo !== valor) onCambio(nuevo)
        }}
        sx={{ flexWrap: 'wrap' }}
      >
        {depositos.map((deposito) => (
          <ToggleButton key={deposito.id} value={deposito.id} sx={{ px: 0.75, py: 0.25, fontSize: 11.5, textTransform: 'none' }}>
            {deposito.nombre}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    )
  }
  return (
    <TextField
      select
      size="small"
      fullWidth
      disabled={disabled}
      value={valor}
      onChange={(evento) => onCambio(evento.target.value)}
      slotProps={{ htmlInput: { 'aria-label': etiqueta } }}
    >
      {depositos.map((deposito) => (
        <MenuItem key={deposito.id} value={deposito.id}>
          {deposito.nombre}
        </MenuItem>
      ))}
    </TextField>
  )
}
