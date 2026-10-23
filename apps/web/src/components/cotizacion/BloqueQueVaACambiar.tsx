import { Box, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { NOTA_REDONDEO, type Previsualizacion, formatearPrecioPrevio, textoPrecios } from '../../lib/cotizacion'

type Props = {
  previa: Previsualizacion
}

const formatoUsd = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Bloque «Qué va a cambiar» (F-PRE-03, FR-014; Cotizacion.dc.html): un mosaico por empresa con la
// cantidad de precios en USD visibles y la tabla «Producto (muestra)» con «<Empresa> hoy» / «Nuevo».
// Se muestra solo si la variación alcanza el umbral (lo decide el diálogo con `previa.recalcula`).
// Mercado Libre queda fuera (Etapa 2). Solo muestra: el cálculo es de la base.
export function BloqueQueVaACambiar({ previa }: Props) {
  return (
    <Stack component="section" spacing={1.5} aria-labelledby="titulo-que-va-a-cambiar">
      <Typography id="titulo-que-va-a-cambiar" component="h3" variant="b" sx={{ fontWeight: 600 }}>Qué va a cambiar</Typography>
      <Stack direction="row" useFlexGap sx={{ gap: 1.25, flexWrap: 'wrap' }}>
        {previa.empresas.map((empresa) => (
          <Box key={empresa.empresaId} sx={{ flex: '1 1 140px', bgcolor: 'action.hover', borderRadius: 2, px: 1.75, py: 1.5 }}>
            <Typography variant="xs">{empresa.nombre}</Typography>
            <Typography variant="t3" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>{textoPrecios(empresa.precios)}</Typography>
            <Typography variant="xs">productos en USD visibles</Typography>
          </Box>
        ))}
      </Stack>
      {previa.muestra.length > 0 ? (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" aria-label="Productos de muestra con su precio de hoy y el nuevo">
            <TableHead>
              <TableRow>
                <TableCell>Producto (muestra)</TableCell>
                {previa.empresas.flatMap((empresa) => [
                  <TableCell key={`${empresa.empresaId}-hoy`} align="right">{empresa.nombre} hoy</TableCell>,
                  <TableCell key={`${empresa.empresaId}-nuevo`} align="right">Nuevo</TableCell>,
                ])}
              </TableRow>
            </TableHead>
            <TableBody>
              {previa.muestra.map((fila) => (
                <TableRow key={`${fila.sku ?? ''}-${fila.producto}`}>
                  <TableCell>
                    <Typography component="span" sx={{ fontWeight: 600 }}>{fila.producto}</Typography>
                    <Typography variant="xs" component="span" sx={{ display: 'block' }}>
                      {[fila.sku, `US$ ${formatoUsd.format(fila.usd)}`].filter(Boolean).join(' · ')}
                    </Typography>
                  </TableCell>
                  {previa.empresas.flatMap((empresa) => {
                    const precio = fila.porEmpresa.find((p) => p.empresaId === empresa.empresaId)
                    return [
                      <TableCell key={`${empresa.empresaId}-hoy`} align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                        {formatearPrecioPrevio(precio?.hoy ?? null)}
                      </TableCell>,
                      <TableCell key={`${empresa.empresaId}-nuevo`} align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatearPrecioPrevio(precio?.nuevo ?? null)}
                      </TableCell>,
                    ]
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      <Typography variant="xs">{NOTA_REDONDEO}</Typography>
    </Stack>
  )
}
