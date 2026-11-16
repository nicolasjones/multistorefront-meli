import { Alert, Typography } from '@mui/material'
import { formatearPorcentaje } from '../../lib/cotizacion'

// Aviso de variación inusual (F-PRE-03): compartido por los diálogos de carga del dólar (Cotización e Inicio).
export function AlertaVariacionInusual({ confirmacionPct }: { confirmacionPct: number }) {
  return (
    <Alert severity="warning">
      <Typography component="p" fontWeight={600}>Variación inusual</Typography>
      La variación supera el {formatearPorcentaje(confirmacionPct)} %. Revisá que el valor sea correcto antes de aplicarlo.
    </Alert>
  )
}
