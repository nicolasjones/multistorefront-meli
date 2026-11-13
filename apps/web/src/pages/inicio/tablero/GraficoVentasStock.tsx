import { useMemo } from 'react'
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useTheme } from '@mui/material'
import {
  BarPlot, ChartsAxisHighlight, ChartsContainer, ChartsLegend, ChartsTooltip, ChartsXAxis, ChartsYAxis, LinePlot, MarkPlot,
} from '@mui/x-charts'
import { EstadoVacio } from '../../../components/estados/EstadosPagina'
import { formatoEntero, type PuntoSerie } from '../../../lib/inicioTablero'

type Props = { serie: ReadonlyArray<PuntoSerie>; hayVentas: boolean; hayStock: boolean }

const formatoDia = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const etiquetaDia = (dia: string) => formatoDia.format(new Date(`${dia}T00:00:00Z`))

// «Ventas y stock en el tiempo» (F-INI-04, FR-004): barras de unidades vendidas por día y línea del stock al
// cierre, con doble eje. Los colores salen del tema (sin colores sueltos); cada serie aparece solo si el
// bloque correspondiente se puede ver. La tabla equivalente da el mismo dato a quien no puede ver el gráfico.
export function GraficoVentasStock({ serie, hayVentas, hayStock }: Props) {
  const tema = useTheme()
  // Sin ventas en ningún día el gráfico está vacío (CA-INI-04-4); un rol que solo ve stock ve la línea de stock.
  const hayDatos = hayVentas
    ? serie.some((punto) => (punto.unidades ?? 0) !== 0)
    : hayStock && serie.some((punto) => punto.stock !== null)
  const dias = useMemo(() => serie.map((punto) => punto.dia), [serie])
  const series = useMemo(() => [
    ...(hayVentas
      ? [{ type: 'bar' as const, id: 'unidades', label: 'Unidades vendidas', data: serie.map((punto) => punto.unidades), yAxisId: 'unidades', color: tema.palette.primary.main }]
      : []),
    ...(hayStock
      ? [{ type: 'line' as const, id: 'stock', label: 'Stock al cierre del día', data: serie.map((punto) => punto.stock), yAxisId: 'stock', color: tema.palette.warning.main, showMark: serie.length <= 31 }]
      : []),
  ], [serie, hayVentas, hayStock, tema.palette.primary.main, tema.palette.warning.main])
  const paso = Math.max(1, Math.ceil(dias.length / 10))
  const xAxis = useMemo(() => [{ id: 'dia', scaleType: 'band' as const, data: dias, valueFormatter: etiquetaDia, tickLabelInterval: (_valor: unknown, indice: number) => indice % paso === 0 }], [dias, paso])
  if (serie.length === 0 || (!hayVentas && !hayStock) || !hayDatos) {
    return <EstadoVacio titulo="Sin datos en el período" descripcion="Cuando haya ventas o movimientos de stock en estos filtros, los vas a ver acá." />
  }
  const descripcion = `Gráfico de ${hayVentas ? 'unidades vendidas por día' : ''}${hayVentas && hayStock ? ' y ' : ''}${hayStock ? 'stock al cierre de cada día' : ''}, del ${etiquetaDia(dias[0])} al ${etiquetaDia(dias[dias.length - 1])}. Los mismos datos están en la tabla de abajo.`

  return (
    <Box>
      <ChartsContainer
        height={300}
        series={series}
        xAxis={xAxis}
        yAxis={[
          { id: 'unidades', scaleType: 'linear', width: 48 },
          { id: 'stock', scaleType: 'linear', position: 'right', width: 56 },
        ]}
        title="Ventas y stock en el tiempo"
        desc={descripcion}
      >
        {hayVentas ? <BarPlot /> : null}
        {hayStock ? <LinePlot /> : null}
        {hayStock ? <MarkPlot /> : null}
        <ChartsXAxis axisId="dia" />
        {hayVentas ? <ChartsYAxis axisId="unidades" label="Unidades" /> : null}
        {hayStock ? <ChartsYAxis axisId="stock" label="Stock" /> : null}
        <ChartsAxisHighlight x="line" />
        <ChartsTooltip />
        <ChartsLegend />
      </ChartsContainer>

      <Box component="details" sx={{ mt: 1 }}>
        <Typography component="summary" variant="s" sx={{ cursor: 'pointer', fontWeight: 600 }}>Ver los datos como tabla</Typography>
        <TableContainer tabIndex={0} role="region" aria-label="Datos del gráfico Ventas y stock en el tiempo" sx={{ maxHeight: 320, mt: 1 }}>
          <Table size="small" stickyHeader>
            <caption style={{ captionSide: 'top', textAlign: 'left' }}>Ventas y stock por día</caption>
            <TableHead>
              <TableRow>
                <TableCell>Día</TableCell>
                {hayVentas ? <TableCell align="right">Unidades vendidas</TableCell> : null}
                {hayStock ? <TableCell align="right">Stock al cierre</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {serie.map((punto) => (
                <TableRow key={punto.dia}>
                  <TableCell component="th" scope="row">{etiquetaDia(punto.dia)}</TableCell>
                  {hayVentas ? <TableCell align="right">{formatoEntero(punto.unidades ?? 0)}</TableCell> : null}
                  {hayStock ? <TableCell align="right">{punto.stock === null ? '—' : formatoEntero(punto.stock)}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}
