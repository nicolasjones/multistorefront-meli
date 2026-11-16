import { Typography } from '@mui/material'
import { NOTA_MARGEN, formatearMargen } from '../../lib/precios'

type Props = {
  // (neto − costo) / neto; null sin precio o sin costo.
  margen: number | null
}

// «Margen estimado (escala x1)» (F-PRE-01, FR-006). El padre solo lo monta con la sección
// `rentabilidad`: sin ella ni el costo ni el margen llegan al navegador.
export function MargenEstimado({ margen }: Props) {
  return (
    <div>
      <Typography variant="body2">
        Margen estimado (escala x1): <strong aria-live="polite">{formatearMargen(margen)}</strong>
      </Typography>
      <Typography variant="caption" color="text.secondary">{NOTA_MARGEN}</Typography>
    </div>
  )
}
