import { Link as RouterLink, useParams } from 'react-router'
import { Box, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { DocumentoA4 } from '../../components/service/DocumentoA4'
import { useDocumentoReparacion } from '../../components/service/useDocumentoReparacion'
import { armarRemitoEntrega, remitoDisponible } from '../../lib/documentosReparacion'
import { formatearARS } from '../../lib/serviceTecnico'

// Remito de entrega imprimible (F-SVC-07, FR-041): solo para reparaciones entregadas; sin costos internos ni ganancia.
export function ServicioRemitoEntrega() {
  const { id } = useParams()
  const { datos, error, cargando, reintentar } = useDocumentoReparacion(id)
  const detalle = id ? `/service-tecnico/reparaciones/${id}` : '/service-tecnico/reparaciones'
  const volver = (
    <Link component={RouterLink} to={detalle} underline="hover">
      ← Volver a la reparación
    </Link>
  )
  if (cargando) return <EstadoCargaPagina />
  if (error || !datos) return <EstadoError descripcion={error ?? 'No pudimos cargar la reparación.'} reintentar={reintentar} />
  if (!remitoDisponible(datos.reparacion)) {
    return (
      <Box>
        {volver}
        <EstadoVacio titulo="Remito no disponible" descripcion="El remito de entrega solo existe para reparaciones entregadas." />
      </Box>
    )
  }

  const remito = armarRemitoEntrega(datos.reparacion, datos.tienda, datos.tecnico)
  return (
    <DocumentoA4 titulo={remito.titulo} numero={remito.numero} tienda={remito.tienda} mostrarIva volver={volver}>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 1 }}>
        {remito.filas.map((fila) => (
          <Box key={fila.etiqueta} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" sx={{ fontWeight: 700 }}>{fila.etiqueta}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>{fila.valor}</Typography>
          </Box>
        ))}
      </Box>
      {remito.sinItems ? (
        <Typography component="p" variant="body2" sx={{ mt: 3 }}>Sin ítems</Typography>
      ) : (
        remito.tablas.map((tabla) => (
          <Box key={tabla.titulo} sx={{ mt: 3 }}>
            <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>{tabla.titulo}</Typography>
            {tabla.filas.length === 0 ? (
              <Typography variant="body2">Sin ítems</Typography>
            ) : (
              <Table size="small" aria-label={tabla.titulo}>
                <TableHead>
                  <TableRow>
                    <TableCell>Descripción</TableCell>
                    <TableCell align="right">Cantidad</TableCell>
                    <TableCell align="right">Precio unitario</TableCell>
                    <TableCell align="right">Subtotal</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tabla.filas.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.descripcion}</TableCell>
                      <TableCell align="right">{item.cantidad}</TableCell>
                      <TableCell align="right">{formatearARS(item.precio_unitario)}</TableCell>
                      <TableCell align="right">{formatearARS(item.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Typography variant="body2" sx={{ textAlign: 'right', mt: 0.5 }}>
              Subtotal {tabla.titulo.toLowerCase()}: {formatearARS(tabla.subtotal)}
            </Typography>
          </Box>
        ))
      )}
      <Typography component="p" variant="subtitle1" sx={{ textAlign: 'right', fontWeight: 700, mt: 2 }}>
        Total (sin IVA): {formatearARS(remito.total)}
      </Typography>
      <Box component="dl" sx={{ m: 0, mt: 2, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 1 }}>
        {remito.entrega.map((fila) => (
          <Box key={fila.etiqueta} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" sx={{ fontWeight: 700 }}>{fila.etiqueta}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>{fila.valor}</Typography>
          </Box>
        ))}
      </Box>
    </DocumentoA4>
  )
}
