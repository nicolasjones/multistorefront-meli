import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { type FilaPrevia, formatearPesosPrecio } from '../../lib/precios'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'

type Props = {
  nombreEmpresa: string
  filas: FilaPrevia[] | null
  cargando: boolean
  hayError: boolean
  // Texto cuando no hay filas porque el ajuste es inválido (la tabla espera la corrección).
  ajusteInvalido: boolean
  reintentar: () => void
}

const SIN_PRECIO = 'Sin precio: falta cargar la cotización'

function Importe({ valor, fuerte }: { valor: number | null; fuerte?: boolean }) {
  if (valor === null) return <span aria-label={SIN_PRECIO} title={SIN_PRECIO}>—</span>
  return <Typography component="span" variant="body2" sx={{ fontWeight: fuerte ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{formatearPesosPrecio(valor)}</Typography>
}

// «Así quedan los precios» (F-PRE-07, FR-013): muestra de productos con el precio central y el
// neto de la empresa. Todo el cálculo viene del servidor (vista previa), con el ajuste sin guardar.
export function TablaAsiQuedan({ nombreEmpresa, filas, cargando, hayError, ajusteInvalido, reintentar }: Props) {
  let cuerpo
  if (hayError) cuerpo = <EstadoError descripcion="No pudimos calcular la vista previa de precios." reintentar={reintentar} />
  else if (ajusteInvalido) cuerpo = <EstadoVacio titulo="Corregí el ajuste" descripcion="La tabla se actualiza cuando el ajuste es válido." />
  else if (filas === null || (cargando && filas.length === 0)) cuerpo = <EstadoCargaPagina lineas={4} />
  else if (filas.length === 0) cuerpo = <EstadoVacio titulo="Todavía no hay productos" descripcion="Cuando cargues productos vas a ver acá cómo quedan sus precios." />
  else {
    cuerpo = (
      <Box sx={{ overflowX: 'auto' }} aria-busy={cargando}>
        <Table size="small" aria-label="Así quedan los precios">
          <TableHead>
            <TableRow>
              <TableCell>Producto (muestra)</TableCell>
              <TableCell align="right">Central</TableCell>
              <TableCell align="right">{nombreEmpresa} · Sin IVA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map((fila) => (
              <TableRow key={fila.productoId}>
                <TableCell>
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{fila.nombre}</Typography>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {fila.sku ? `${fila.sku} · ` : ''}{fila.moneda}
                  </Typography>
                </TableCell>
                <TableCell align="right"><Importe valor={fila.centralArs} /></TableCell>
                <TableCell align="right"><Importe valor={fila.netoArs} fuerte /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    )
  }

  return (
    <Box component="section" aria-labelledby="asi-quedan-titulo" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Typography id="asi-quedan-titulo" component="h2" variant="h6">Así quedan los precios</Typography>
        <Typography variant="body2" color="text.secondary">Se actualiza con el ajuste</Typography>
      </Box>
      {cuerpo}
    </Box>
  )
}
