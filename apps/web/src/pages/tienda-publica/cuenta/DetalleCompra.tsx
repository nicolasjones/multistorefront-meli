import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { EstadoCargaPagina, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import {
  esSinAcceso,
  ETIQUETA_TIPO,
  formatearFechaCuenta,
  formatearCantidad,
  formatearImporteArs,
  formatearNumeroComprobante,
  leerMiCompra,
  type DetalleCompra as Detalle,
} from '../../../lib/tiendaCuentaDatos'
import { ErrorConReintento } from '../ErrorConReintento'
import { LINEA_SUAVE } from '../layout/medidas'
import { useCelular } from '../useAnchoCelular'
import { EstadoComprobante } from './EstadoComprobante'

type Estado =
  | { clave: string; fase: 'lista'; detalle: Detalle }
  | { clave: string; fase: 'no_encontrada' }
  | { clave: string; fase: 'error' }

const ID_TITULO = 'detalle-compra-titulo'

// Detalle de una compra, presupuesto o nota de crédito propios (F-CLI-20, FR-005/FR-006, P-3): `Dialog` a pantalla completa
// en celular y tableta y de `md` desde escritorio. Lo que se ve es la lista blanca del contrato (líneas y totales): ni costos,
// ni márgenes, ni descuento, ni operador, ni depósito. Un comprobante ajeno o inexistente muestra LO MISMO («No encontramos ese
// comprobante»): no revela cuál de los dos casos es.
export function DetalleCompra({ host, comprobanteId, alCerrar, alSinAcceso }: { host: string; comprobanteId: string; alCerrar: () => void; alSinAcceso: () => void }) {
  const celular = useCelular()
  const [intento, setIntento] = useState(0)
  const [estado, setEstado] = useState<Estado | null>(null)
  const clave = JSON.stringify([host, comprobanteId, intento])

  useEffect(() => {
    let cancelada = false
    leerMiCompra(host, comprobanteId)
      .then((detalle) => { if (!cancelada) setEstado(detalle ? { clave, fase: 'lista', detalle } : { clave, fase: 'no_encontrada' }) })
      .catch((error: unknown) => {
        if (cancelada) return
        if (esSinAcceso(error)) {
          alSinAcceso()
          return
        }
        console.error('No se pudo cargar el detalle del comprobante', error instanceof Error ? error.message : error)
        setEstado({ clave, fase: 'error' })
      })
    return () => { cancelada = true }
    // `clave` resume host, comprobante e intento; `alSinAcceso` es estable en la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])
  const vigente = estado && estado.clave === clave ? estado : null
  const detalle = vigente?.fase === 'lista' ? vigente.detalle : null
  const titulo = detalle ? `${ETIQUETA_TIPO[detalle.tipo]} ${formatearNumeroComprobante(detalle.numero)}` : 'Detalle del comprobante'

  return (
    <Dialog open onClose={alCerrar} fullScreen={celular} fullWidth maxWidth="md" aria-labelledby={ID_TITULO}>
      <DialogTitle id={ID_TITULO} component="h2" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, overflowWrap: 'anywhere' }}>
        {titulo}
        {detalle ? <EstadoComprobante estado={detalle.estado} /> : null}
      </DialogTitle>
      <DialogContent dividers>
        {!vigente ? <EstadoCargaPagina etiqueta="Cargando el comprobante" /> : null}
        {vigente?.fase === 'error' ? <ErrorConReintento titulo="No pudimos cargar el comprobante." alReintentar={reintentar} /> : null}
        {vigente?.fase === 'no_encontrada' ? (
          <VolverAMisCompras alVolver={alCerrar} />
        ) : null}
        {detalle ? <Cuerpo detalle={detalle} celular={celular} /> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}

function VolverAMisCompras({ alVolver }: { alVolver: () => void }) {
  return (
    <EstadoVacio
      titulo="No encontramos ese comprobante"
      accion={<Button color="inherit" onClick={alVolver} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Volver a mis compras</Button>}
    />
  )
}

function Cuerpo({ detalle, celular }: { detalle: Detalle; celular: boolean }) {
  return (
    <Box>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
        <Typography component="dt" color="text.secondary">Fecha</Typography>
        <Typography component="dd" sx={{ m: 0 }}>{formatearFechaCuenta(detalle.fecha)}</Typography>
        {detalle.tipo === 'presupuesto' && detalle.validoHasta ? (
          <>
            <Typography component="dt" color="text.secondary">Válido hasta</Typography>
            <Typography component="dd" sx={{ m: 0 }}>{formatearFechaCuenta(detalle.validoHasta)}</Typography>
          </>
        ) : null}
      </Box>
      {detalle.tipo === 'presupuesto' ? <Alert severity="info" sx={{ mt: 2 }}>Es un presupuesto: no reserva stock ni es una compra.</Alert> : null}
      <Box sx={{ mt: 2 }}>
        {celular ? (
          <Box component="ul" aria-label="Líneas del comprobante" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
            {detalle.lineas.map((linea, indice) => (
              <Box component="li" key={`${indice}-${linea.descripcion}`} sx={{ border: LINEA_SUAVE, borderRadius: '8px', p: 1.5, display: 'flex', justifyContent: 'space-between', gap: 2 /* estilos-sueltos: ok */ }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{linea.descripcion}</Typography>
                  {linea.codigo ? <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */, overflowWrap: 'anywhere' }}>Cód. {linea.codigo}</Typography> : null}
                  <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{formatearCantidad(linea.cantidad)} × {formatearImporteArs(linea.precioUnitario)}</Typography>
                </Box>
                <Typography sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatearImporteArs(linea.subtotal)}</Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Líneas del comprobante">
              <TableHead>
                <TableRow>
                  <TableCell>Descripción</TableCell>
                  <TableCell>Código</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                  <TableCell align="right">Precio unitario</TableCell>
                  <TableCell align="right">Subtotal</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {detalle.lineas.map((linea, indice) => (
                  <TableRow key={`${indice}-${linea.descripcion}`}>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{linea.descripcion}</TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{linea.codigo ?? <Box component="span" sx={SOLO_LECTORES}>Sin código</Box>}</TableCell>
                    <TableCell align="right">{formatearCantidad(linea.cantidad)}</TableCell>
                    <TableCell align="right">{formatearImporteArs(linea.precioUnitario)}</TableCell>
                    <TableCell align="right">{formatearImporteArs(linea.subtotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
      <Box component="dl" sx={{ m: 0, mt: 2, ml: 'auto', maxWidth: (tema) => tema.spacing(40), display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 2, rowGap: 0.5 }}>
        <Typography component="dt" color="text.secondary">Subtotal sin IVA</Typography>
        <Typography component="dd" align="right" sx={{ m: 0 }}>{formatearImporteArs(detalle.totalSinIva)}</Typography>
        <Typography component="dt" color="text.secondary">IVA</Typography>
        <Typography component="dd" align="right" sx={{ m: 0 }}>{formatearImporteArs(detalle.iva)}</Typography>
        <Typography component="dt" sx={{ fontWeight: 700 }}>Total con IVA</Typography>
        <Typography component="dd" align="right" sx={{ m: 0, fontWeight: 700 }}>{formatearImporteArs(detalle.totalConIva)}</Typography>
      </Box>
    </Box>
  )
}
