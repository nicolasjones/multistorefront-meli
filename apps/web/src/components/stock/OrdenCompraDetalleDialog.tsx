import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useDetalleOrdenCompra, useCambiarEstadoOrdenCompra } from '../../hooks/useOrdenesCompra'
import { ESTADOS_ORDEN, mensajeDeErrorOrden } from '../../lib/ordenesCompra'

type Props = {
  abierto: boolean
  ordenId: string | null
  puedeEditar: boolean
  onCerrar: () => void
  onCambiada: () => void
  onAnular: (ordenId: string) => void
}

const MENSAJE_POR_DEFECTO = 'No pudimos cambiar el estado de la orden. Intentá de nuevo.'

const formatearFecha = (fecha: string | null) => (fecha ? fecha.split('-').reverse().join('/') : '—')

// F-PRV-09: detalle de la orden (cabecera y líneas) y sus dos transiciones:
// «Marcar como recibida» y «Anular». Recibir NO mueve stock: la mercadería entra por
// «Ingreso de mercadería».
export function OrdenCompraDetalleDialog({ abierto, ordenId, puedeEditar, onCerrar, onCambiada, onAnular }: Props) {
  const { detalle, hayError, cargando, recargar } = useDetalleOrdenCompra(abierto ? ordenId : null)
  const { cambiar, enviando } = useCambiarEstadoOrdenCompra()
  const [error, setError] = useState<string | null>(null)

  const marcarRecibida = async () => {
    if (!detalle || enviando) return
    setError(null)
    const resultado = await cambiar(detalle.id, 'recibida')
    if (!resultado.ok) {
      setError(mensajeDeErrorOrden(resultado.error, MENSAJE_POR_DEFECTO))
      return
    }
    void recargar()
    onCambiada()
  }

  const estado = detalle ? ESTADOS_ORDEN.find((opcion) => opcion.valor === detalle.estado) : undefined

  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-detalle-orden-compra">
      <DialogTitle id="titulo-detalle-orden-compra">
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <span>Orden de compra</span>
          {estado ? <EtiquetaEstado texto={estado.etiqueta} variante={estado.variante} /> : null}
        </Stack>
      </DialogTitle>
      <DialogContent>
        {cargando ? (
          <EstadoCargaPagina />
        ) : hayError ? (
          <EstadoError descripcion="No pudimos cargar el detalle de la orden." reintentar={() => void recargar()} />
        ) : !detalle ? (
          <Typography variant="xs">No encontramos la orden.</Typography>
        ) : (
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack spacing={0.5}>
              <Typography variant="s">Proveedor: <strong>{detalle.proveedor}</strong></Typography>
              <Typography variant="s">Empresa: <strong>{detalle.empresa ?? '—'}</strong></Typography>
              <Typography variant="s">Fecha: <strong>{formatearFecha(detalle.fecha)}</strong></Typography>
              {detalle.fecha_recepcion ? (
                <Typography variant="s">Recibida: <strong>{formatearFecha(detalle.fecha_recepcion)}</strong></Typography>
              ) : null}
              {detalle.motivo_anulacion ? (
                <Typography variant="s">Motivo de la anulación: <strong>{detalle.motivo_anulacion}</strong></Typography>
              ) : null}
              {detalle.observaciones ? (
                <Typography variant="s">Observaciones: <strong>{detalle.observaciones}</strong></Typography>
              ) : null}
            </Stack>

            <Table size="small" aria-label="Productos de la orden de compra">
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detalle.lineas.map((linea) => (
                  <TableRow key={linea.producto_id}>
                    <TableCell>
                      <Stack spacing={0}>
                        <Typography variant="b">{linea.producto_nombre}</Typography>
                        <Typography variant="xs">{linea.producto_sku ?? '—'}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{linea.cantidad}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
        {puedeEditar && detalle?.estado === 'emitida' ? (
          <>
            <Button color="warning" onClick={() => onAnular(detalle.id)} disabled={enviando}>Anular</Button>
            <Button variant="contained" onClick={() => void marcarRecibida()} disabled={enviando}>
              {enviando ? 'Guardando…' : 'Marcar como recibida'}
            </Button>
          </>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
