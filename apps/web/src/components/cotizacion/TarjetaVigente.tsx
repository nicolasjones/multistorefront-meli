import { Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import {
  formatearCotizacion,
  subtituloCargadaHoy,
  subtituloVigente,
  type CotizacionDelDia,
  type CotizacionVigente,
} from '../../lib/cotizacion'

type Props = {
  vigente: CotizacionVigente
  productosUsd: number
  // null mientras carga o si falló: sin indicador y con la «Última carga» de siempre.
  delDia?: CotizacionDelDia | null
}

// Tarjeta «Vigente» (F-PRE-02, FR-005; Cotizacion.dc.html): valor, «Última carga: <fecha> por
// <quién>» y cuántos productos tienen precio en USD. Con `delDia` (F-PRE-05, FR-022) suma el indicador
// «Al día» / «Sin cargar hoy» y, si hoy se cargó, el subtítulo «Cargada hoy <hora> por <quién>».
export function TarjetaVigente({ vigente, productosUsd, delDia = null }: Props) {
  const subtitulo = delDia?.cargadaHoy ? subtituloCargadaHoy(delDia) : subtituloVigente(vigente)
  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-cotizacion-vigente">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography id="titulo-cotizacion-vigente" component="h2" variant="t3">Vigente</Typography>
              {delDia ? <Chip size="small" color={delDia.cargadaHoy ? 'success' : 'warning'} label={delDia.cargadaHoy ? 'Al día' : 'Sin cargar hoy'} /> : null}
            </Stack>
            <Typography variant="kpi" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatearCotizacion(vigente.valor)}
            </Typography>
            <Typography variant="s">{subtitulo}</Typography>
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
