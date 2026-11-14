import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { formatearPesosPrecio } from '../../lib/precios'
import { type LineaComprobante } from '../../lib/ventasLineas'
import { SOLO_LECTORES } from '../base/solo-lectores'

// Precio de una línea de venta (MSF-816, FR-016/FR-017). Cuando la línea ganó una promoción, al precio
// cobrado le sigue el precio de referencia tachado (el normal del cliente). El tachado no es lo único que lo
// dice: un lector de pantalla oye «Precio promocional $ 800» y «Precio anterior $ 1.000».
export function PrecioLinea({
  linea,
  precio,
  formatear = formatearPesosPrecio,
}: {
  linea: Pick<LineaComprobante, 'precio_unitario' | 'precio_referencia'>
  /** El precio cobrado, ya formateado por quien lo muestra (campo editable o texto). */
  precio: ReactNode
  /** Formato del importe: el comprobante y el mostrador usan el mismo. */
  formatear?: (valor: number) => string
}) {
  const referencia = linea.precio_referencia
  if (referencia == null) {
    return <>{precio}</>
  }
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Box component="span" sx={SOLO_LECTORES}>Precio promocional </Box>
      {precio}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
        <Box component="span" sx={SOLO_LECTORES}>Precio anterior </Box>
        <Box component="del">{formatear(referencia)}</Box>
      </Typography>
    </Box>
  )
}
