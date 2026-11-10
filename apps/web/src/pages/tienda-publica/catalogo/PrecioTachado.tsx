import { Box, Typography } from '@mui/material'
import type { TypographyProps } from '@mui/material'
import { formatearPrecioArs } from '../../../lib/tiendaListado'

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

// Precio vigente de la tienda con el precio anterior tachado (F-PRE-11, FR-018). El anterior solo se
// muestra si es MAYOR que el vigente: sin promoción (o con un promocional que no baja el precio) se ve
// el precio de siempre, sin cambios visuales. El tachado no es lo único que lo dice: un lector de
// pantalla oye «Precio anterior $ 3.000» y «Precio actual $ 2.500».
export function PrecioTachado({
  precio,
  precioAnterior,
  variant = 'h6',
}: {
  precio: number | null
  precioAnterior?: number | null
  variant?: TypographyProps['variant']
}) {
  const actual = formatearPrecioArs(precio)
  if (!actual) return null
  const anterior = precioAnterior != null && precio !== null && precioAnterior > precio ? formatearPrecioArs(precioAnterior) : null
  if (!anterior) return <Typography variant={variant} component="p">{actual}</Typography>
  return (
    <Box data-testid="precio-promocional" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
      <Typography variant={variant} component="p" sx={{ m: 0 }}>
        <Box component="span" sx={visuallyHidden}>Precio actual </Box>
        {actual}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p" sx={{ m: 0 }}>
        <Box component="span" sx={visuallyHidden}>Precio anterior </Box>
        <Box component="del" data-testid="precio-anterior">{anterior}</Box>
      </Typography>
    </Box>
  )
}
