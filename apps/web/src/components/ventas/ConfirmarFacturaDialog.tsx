import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import { disponibleDeLinea } from '../../lib/ventasLineas'
import {
  TITULO_CONFIRMAR_FACTURA,
  cantidadADejarReservada,
  confirmarComprobante,
  lineasConFaltante,
  mensajeDeConfirmacion,
} from '../../lib/ventasConfirmacion'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  comprobante: Comprobante
  onCerrar: () => void
  // La base confirmó: la pantalla relee el comprobante, que pasa a solo lectura.
  onConfirmado: () => void
}

// Diálogo «Confirmar factura» (F-VTA-07, FR-037). Pide confirmación antes de descontar, muestra el error de
// stock (producto y depósito) sin cerrarse y no ofrece confirmar mientras se vea un faltante. La base vuelve a
// verificar todo: lo que se ve acá es un adelanto, no la autoridad.
export function ConfirmarFacturaDialog({ open, comprobante, onCerrar, onConfirmado }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-confirmar-factura">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido comprobante={comprobante} onCerrar={onCerrar} onConfirmado={onConfirmado} />
    </Dialog>
  )
}

function Contenido({ comprobante, onCerrar, onConfirmado }: Omit<Props, 'open'>) {
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const faltantes = lineasConFaltante(comprobante.lineas)
  const aPedido = cantidadADejarReservada(comprobante.lineas)

  const confirmar = async () => {
    if (confirmando) return
    setConfirmando(true)
    setError(null)
    try {
      await confirmarComprobante(comprobante.id)
      onConfirmado()
    } catch (falla) {
      setError(mensajeDeConfirmacion(falla))
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
