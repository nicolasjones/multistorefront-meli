import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import { formatearPesosPrecio } from '../../lib/precios'
import { MENSAJE_PRECIOS_CAMBIARON_COBRO, disponibleDeLinea } from '../../lib/ventasLineas'
import {
  TITULO_CONFIRMAR_FACTURA,
  cantidadADejarReservada,
  confirmarComprobante,
  esPreciosCambiaron,
  lineasConFaltante,
  mensajeDeConfirmacion,
} from '../../lib/ventasConfirmacion'
import { TituloDialogo } from '../base/TituloDialogo'
import { AvisoPreciosCambiaron } from './AvisoPreciosCambiaron'

type Props = {
  open: boolean
  comprobante: Comprobante
  onCerrar: () => void
  // La base confirmó: la pantalla relee el comprobante, que pasa a solo lectura.
  onConfirmado: () => void
  // La base rechazó con `precios_cambiaron` (FR-018): la pantalla re-guarda las mismas líneas y el comprobante nuevo
  // llega por `comprobante`. El diálogo no reintenta la confirmación solo.
  onPreciosCambiaron?: () => Promise<void>
}

// Diálogo «Confirmar factura» (F-VTA-07, FR-037). Pide confirmación antes de descontar, muestra el error de
// stock (producto y depósito) sin cerrarse y no ofrece confirmar mientras se vea un faltante. La base vuelve a
// verificar todo: lo que se ve acá es un adelanto, no la autoridad.
export function ConfirmarFacturaDialog({ open, comprobante, onCerrar, onConfirmado, onPreciosCambiaron }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-confirmar-factura">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido comprobante={comprobante} onCerrar={onCerrar} onConfirmado={onConfirmado} onPreciosCambiaron={onPreciosCambiaron} />
    </Dialog>
  )
}

function Contenido({ comprobante, onCerrar, onConfirmado, onPreciosCambiaron }: Omit<Props, 'open'>) {
  const [confirmando, setConfirmando] = useState(false)
  const [preciosCambiaron, setPreciosCambiaron] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const faltantes = lineasConFaltante(comprobante.lineas)
  const aPedido = cantidadADejarReservada(comprobante.lineas)

  const confirmar = async () => {
    if (confirmando) return
    setConfirmando(true)
    setError(null)
    setPreciosCambiaron(false)
    try {
      await confirmarComprobante(comprobante.id)
      onConfirmado()
    } catch (falla) {
      if (esPreciosCambiaron(falla)) {
        // Sin efectos en la base: se reprecian las líneas y se pide confirmar de nuevo con el total nuevo.
        await onPreciosCambiaron?.()
        setPreciosCambiaron(true)
      } else {
        setError(mensajeDeConfirmacion(falla))
      }
      setConfirmando(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-confirmar-factura" onCerrar={confirmando ? undefined : onCerrar}>
        {TITULO_CONFIRMAR_FACTURA} {comprobante.numero}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            Al confirmar, la factura descuenta del stock cada producto en el depósito elegido en su línea
            {aPedido > 0 ? ' y reserva los productos «A pedido» (se descuentan al entregarlos)' : ''}. Después de confirmarla ya no se puede modificar.
          </Typography>
          {faltantes.length > 0 ? (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                No hay stock suficiente para confirmar. Corregí estas líneas y volvé a intentar:
              </Typography>
              <List dense disablePadding>
                {faltantes.map((linea) => (
                  <ListItem key={linea.id} disableGutters sx={{ py: 0 }}>
                    <ListItemText
                      primary={`${linea.descripcion} en ${linea.deposito}: hay ${disponibleDeLinea(linea)} y la línea pide ${linea.cantidad}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Alert>
          ) : null}
          {preciosCambiaron ? (
            <AvisoPreciosCambiaron mensaje={`${MENSAJE_PRECIOS_CAMBIARON_COBRO} Total ahora: ${formatearPesosPrecio(comprobante.total_con_iva)}.`} />
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={confirmando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={confirmando || faltantes.length > 0}>
          {confirmando ? 'Confirmando…' : 'Confirmar'}
        </Button>
      </DialogActions>
    </>
  )
}
