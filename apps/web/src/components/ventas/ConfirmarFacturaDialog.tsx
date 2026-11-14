import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import { disponibleDeLinea } from '../../lib/ventasLineas'
import {
  TITULO_CONFIRMAR_FACTURA,
  cantidadADejarReservada,
  confirmarComprobante,
  esPreciosCambiaron,
  lineasConFaltante,
  mensajeDeConfirmacion,
  repreciarComprobante,
  MENSAJE_PRECIOS_CAMBIARON,
} from '../../lib/ventasConfirmacion'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  comprobante: Comprobante
  onCerrar: () => void
  // La base confirmó: la pantalla relee el comprobante, que pasa a solo lectura.
  onConfirmado: () => void
  // MSF-816 (FR-018): cambió el precio de una línea: la pantalla recibe el comprobante repreciado.
  onRepreciado: (comprobante: Comprobante) => void
}

// Diálogo «Confirmar factura» (F-VTA-07, FR-037). Pide confirmación antes de descontar, muestra el error de
// stock (producto y depósito) sin cerrarse y no ofrece confirmar mientras se vea un faltante. La base vuelve a
// verificar todo: lo que se ve acá es un adelanto, no la autoridad.
export function ConfirmarFacturaDialog({ open, comprobante, onCerrar, onConfirmado, onRepreciado }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-confirmar-factura">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido comprobante={comprobante} onCerrar={onCerrar} onConfirmado={onConfirmado} onRepreciado={onRepreciado} />
    </Dialog>
  )
}

function Contenido({ comprobante, onCerrar, onConfirmado, onRepreciado }: Omit<Props, 'open'>) {
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const faltantes = lineasConFaltante(comprobante.lineas)
  const aPedido = cantidadADejarReservada(comprobante.lineas)

  const confirmar = async () => {
    if (confirmando) return
    setConfirmando(true)
    setError(null)
    setAviso(null)
    try {
      await confirmarComprobante(comprobante.id)
      onConfirmado()
    } catch (falla) {
      // MSF-816 (FR-018): el precio de alguna línea cambió (promoción vencida o nueva). Se reprecia el
      // comprobante y se avisa; la persona vuelve a confirmar. NO se reintenta la confirmación sola.
      if (esPreciosCambiaron(falla)) {
        try {
          onRepreciado(await repreciarComprobante(comprobante))
          setAviso(MENSAJE_PRECIOS_CAMBIARON)
        } catch (fallaRepreo) {
          setError(mensajeDeConfirmacion(fallaRepreo))
        }
        setConfirmando(false)
        return
      }
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
          {aviso ? <Alert severity="warning" role="status">{aviso}</Alert> : null}
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
