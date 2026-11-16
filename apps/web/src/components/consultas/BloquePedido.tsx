import { Box, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery } from '@mui/material'
import type { ItemsConsulta } from '../../hooks/useItemsConsulta'
import { totalReferenciaPedido, type ItemConsulta } from '../../lib/consultas'
import { formatearImporteArs } from '../../lib/tiendaCuentaDatos'
import { EstadoError } from '../estados/EstadosPagina'

const importe = (valor: number | null) => (valor === null ? 'Sin precio' : formatearImporteArs(valor))
const subtotal = (item: ItemConsulta) => (item.precio_referencia === null ? null : Math.round(item.precio_referencia * item.cantidad * 100) / 100)

// Bloque «Pedido» del detalle de una consulta de origen pedido (MSF-176, B1, FR-031, P-6): tabla Producto · SKU · Cantidad · Precio de referencia · Subtotal de referencia (en celular, una tarjeta por línea),
// el total de referencia y la nota «Precios de referencia calculados al enviar…». Cada precio lleva el rótulo «referencia», nunca «precio» a secas. Todo es TEXTO de la tienda (React lo escapa:
// un `<script>` en una descripción se ve literal). Estados: cargando (esqueleto), error con «Reintentar» y sin ítems.
export function BloquePedido({ items }: { items: ItemsConsulta }) {
  const celular = useMediaQuery('(max-width:599.95px)')
  return (
    <Box component="section" aria-labelledby="pedido-titulo" data-testid="bloque-pedido">
      <Typography id="pedido-titulo" variant="xs" component="h3">Pedido</Typography>
      {items.fase === 'cargando' ? (
        <Box role="status" aria-label="Cargando los productos del pedido" sx={{ mt: 1 }}>
          <Typography variant="xs" sx={{ display: 'block', mb: 1 }}>Cargando los productos del pedido</Typography>
          <Skeleton variant="rounded" height={32} sx={{ mb: 1 }} />
          <Skeleton variant="rounded" height={32} />
        </Box>
      ) : null}
      {items.fase === 'error' ? (
        <Box sx={{ mt: 1 }}>
          <EstadoError titulo="No pudimos cargar los productos del pedido." reintentar={items.reintentar} />
        </Box>
      ) : null}
      {items.fase === 'lista' && items.items.length === 0 ? (
        <Typography sx={{ mt: 1 }} color="text.secondary">Este pedido no tiene productos cargados.</Typography>
      ) : null}
      {items.fase === 'lista' && items.items.length > 0 ? (
        <>
          {celular ? (
            <Stack component="ul" aria-label="Productos del pedido" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0, mt: 1 }}>
              {items.items.map((item) => (
                <Paper key={item.orden} component="li" variant="outlined" sx={{ p: 1.5 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.descripcion}</Typography>
                  {item.sku ? <Typography variant="xs" sx={{ display: 'block', overflowWrap: 'anywhere' }}>SKU {item.sku}</Typography> : null}
                  <Typography variant="xs" sx={{ display: 'block' }}>Cantidad {item.cantidad}</Typography>
                  <Typography variant="xs" sx={{ display: 'block' }}>Precio de referencia: {importe(item.precio_referencia)}</Typography>
                  <Typography variant="xs" sx={{ display: 'block' }}>Subtotal de referencia: {importe(subtotal(item))}</Typography>
                </Paper>
              ))}
            </Stack>
          ) : (
            <TableContainer sx={{ mt: 1 }}>
              <Table size="small" aria-label="Productos del pedido">
                <TableHead>
                  <TableRow>
                    <TableCell>Producto</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Cantidad</TableCell>
                    <TableCell align="right">Precio de referencia</TableCell>
                    <TableCell align="right">Subtotal de referencia</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.items.map((item) => (
                    <TableRow key={item.orden}>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.descripcion}</TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.sku ?? '—'}</TableCell>
                      <TableCell align="right">{item.cantidad}</TableCell>
                      <TableCell align="right">{importe(item.precio_referencia)}</TableCell>
                      <TableCell align="right">{importe(subtotal(item))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          <Typography sx={{ mt: 1, fontWeight: 700 }} data-testid="total-referencia-pedido">
            Total de referencia {importe(totalReferenciaPedido(items.items))}
          </Typography>
          <Typography variant="xs" sx={{ display: 'block' }}>
            Precios de referencia calculados al enviar, tal como los vio la persona en la tienda. Confirmalos al responder.
          </Typography>
        </>
      ) : null}
    </Box>
  )
}
