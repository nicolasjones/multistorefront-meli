import { Link as RouterLink } from 'react-router'
import { Box, Card, CardActionArea, CardContent, Typography } from '@mui/material'

type Props = {
  rotulo: string
  valor: string
  detalle?: string
  // Variación contra el período anterior: el signo manda el color del detalle.
  tendencia?: 'sube' | 'baja' | 'igual' | null
  // Enlace al listado correspondiente ya filtrado (FR-005).
  to?: string
}

const COLOR: Record<'sube' | 'baja' | 'igual', string> = { sube: 'success.main', baja: 'error.main', igual: 'text.secondary' }

// Un indicador de Inicio: rótulo, valor grande y detalle. Con `to` es una tarjeta navegable completa.
export function Indicador({ rotulo, valor, detalle, tendencia = null, to }: Props) {
  const contenido = (
    <CardContent>
      <Typography variant="s" color="text.secondary" component="p">{rotulo}</Typography>
      <Typography variant="kpi" component="p" sx={{ mt: 0.5 }}>{valor}</Typography>
      {detalle ? (
        <Typography variant="xs" component="p" sx={{ mt: 0.5, color: tendencia ? COLOR[tendencia] : 'text.secondary' }}>{detalle}</Typography>
      ) : null}
    </CardContent>
  )
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {to ? (
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }} aria-label={`${rotulo}: ${valor}${detalle ? `, ${detalle}` : ''}. Ver detalle`}>
          {contenido}
        </CardActionArea>
      ) : <Box sx={{ height: '100%' }}>{contenido}</Box>}
    </Card>
  )
}
