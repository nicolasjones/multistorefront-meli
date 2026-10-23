import { Card, CardContent, Stack, Typography } from '@mui/material'
import { formatearCotizacion, subtituloVigente, type CotizacionVigente } from '../../lib/cotizacion'

type Props = {
  vigente: CotizacionVigente
  productosUsd: number
}

// Tarjeta «Vigente» (F-PRE-02, FR-005; Cotizacion.dc.html): valor, «Última carga: <fecha> por
// <quién>» y cuántos productos tienen precio en USD. El indicador «Al día» / «Sin cargar hoy» es F-PRE-05.
export function TarjetaVigente({ vigente, productosUsd }: Props) {
  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-cotizacion-vigente">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Typography id="titulo-cotizacion-vigente" component="h2" variant="t3">Vigente</Typography>
            <Typography variant="kpi" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatearCotizacion(vigente.valor)}
            </Typography>
            <Typography variant="s">{subtituloVigente(vigente)}</Typography>
          </Stack>
          <Stack spacing={0.5} sx={{ alignItems: { xs: 'flex-start', sm: 'flex-end' } }}>
            <Typography variant="s">Productos con precio en USD</Typography>
            <Typography variant="kpi" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>{productosUsd}</Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
