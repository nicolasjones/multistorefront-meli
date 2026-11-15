import { Typography } from '@mui/material'
import type { StockEstadoItem } from '../../lib/reparaciones'

export const ETIQUETA_PENDIENTE_STOCK = 'Pendiente de stock'

// Marca de un repuesto según su estado de stock: pendiente de stock (F-SVC-12, FR-031) o, en una reparación anulada,
// consumido / devuelto (F-SVC-11, FR-023, FR-025). El resto de los estados no lleva marca.
const MARCA_POR_ESTADO: Partial<Record<StockEstadoItem, string>> = {
  pendiente: ETIQUETA_PENDIENTE_STOCK,
  consumido: 'Consumido',
  devuelto: 'Devuelto',
}

type Props = { estado: StockEstadoItem } | { etiqueta: string }

export function MarcaStockItem(props: Props) {
  const texto = 'etiqueta' in props ? props.etiqueta : MARCA_POR_ESTADO[props.estado]
  if (!texto) return null
  return (
    <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>
      {texto}
    </Typography>
  )
}
