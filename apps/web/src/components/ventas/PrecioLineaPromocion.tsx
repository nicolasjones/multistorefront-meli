import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { SOLO_LECTORES } from '../base/solo-lectores'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import {
  ROTULO_PROMOCION,
  TEXTO_PRECIO_ANTERIOR,
  TEXTO_PRECIO_PROMOCIONAL,
  lineaEnPromocion,
  type LineaComprobante,
} from '../../lib/ventasLineas'

type Props = {
  linea: Pick<LineaComprobante, 'precio_referencia' | 'precio_manual' | 'sin_stock'>
  /** Formato del importe (cada pantalla ya tiene el suyo: comprobante y mostrador no coinciden en el símbolo). */
  formatear: (valor: number) => string
  /** El precio cobrado tal como lo dibuja cada pantalla (texto o campo editable). */
  children: ReactNode
}

// Celda de precio de una línea (F-2, FR-016/FR-017, prototipo `VentasComprobante`): sin promoción devuelve el precio
// tal cual (idéntico a hoy); con promoción suma el precio anterior TACHADO arriba y la leyenda «Promoción» debajo.
// Accesible: el tachado no es lo único que lo dice, el lector de pantalla anuncia «Precio anterior» y «Precio
// promocional» (texto, no solo color ni tachado) y la leyenda es texto visible.
export function PrecioLineaPromocion({ linea, formatear, children }: Props) {
  if (!lineaEnPromocion(linea) || typeof linea.precio_referencia !== 'number') return <>{children}</>
  return (
    <>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ whiteSpace: 'nowrap' }}>
        <Box component="span" sx={SOLO_LECTORES}>{TEXTO_PRECIO_ANTERIOR}: </Box>
        <Box component="s">{formatear(linea.precio_referencia)}</Box>
      </Typography>
      <Box component="span" sx={SOLO_LECTORES}>{TEXTO_PRECIO_PROMOCIONAL}: </Box>
      {children}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <EtiquetaEstado texto={ROTULO_PROMOCION} variante="info" />
      </Box>
    </>
  )
}
