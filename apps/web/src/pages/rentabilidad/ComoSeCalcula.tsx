import { Box, Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import type { Empresa } from '../../hooks/useEmpresas'

export const TEXTO_ESTIMACION = 'Estimación con los datos disponibles: no incluye impuestos, envíos ni otros costos.'

// Tarjeta «Cómo se calcula» del resumen (F-REN-02, FR-014; RentabilidadResumen.dc.html). Una fila por
// tienda de la organización; la fila de Mercado Libre del prototipo NO va (FR-010, Etapa 2). Es solo
// presentación: la lista de tiendas la resuelve la pantalla.
export function ComoSeCalcula({ empresas }: { empresas: readonly Pick<Empresa, 'id' | 'nombre'>[] }) {
  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-como-se-calcula">
      <CardContent>
        <Typography id="titulo-como-se-calcula" component="h2" variant="t3">Cómo se calcula</Typography>
        <Box sx={{ mt: 2, px: 2.25, py: 1.75, borderRadius: (tema) => tema.shape.borderRadius, bgcolor: 'action.hover' }}>
          <Typography component="p" fontWeight={600}>Margen = Precio − Costo − Comisión</Typography>
          <Typography component="p" variant="b" sx={{ mt: 0.5 }}>Margen % = Margen ÷ Precio</Typography>
        </Box>
        <TableContainer sx={{ mt: 1.5 }}>
          <Table size="small" aria-label="Precio y comisión por canal">
            <TableHead>
              <TableRow>
                <TableCell>Canal</TableCell>
                <TableCell>Precio usado</TableCell>
                <TableCell>Comisión / costo disponible</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {empresas.map((empresa, indice) => (
                <TableRow key={empresa.id}>
                  <TableCell component="th" scope="row">{empresa.nombre}</TableCell>
                  <TableCell>Precio central</TableCell>
                  <TableCell>
                    <Typography component="span" variant="b" color="text.secondary">
                      {indice === 0 ? 'Sin comisión: no hay checkout ni pagos en esta versión' : 'Sin comisión'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography component="p" variant="xs" sx={{ mt: 1.25 }}>{TEXTO_ESTIMACION}</Typography>
      </CardContent>
    </Card>
  )
}
