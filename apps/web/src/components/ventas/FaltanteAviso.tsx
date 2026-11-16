import { Alert, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import {
  ETIQUETA_A_PEDIDO,
  disponibleDeLinea,
  hayFaltante,
  mensajeFaltante,
  type LineaComprobante,
} from '../../lib/ventasLineas'

type PropsLinea = { linea: LineaComprobante }

// Columna «Stock» de una línea (FR-017): Disp. = stock del depósito elegido − reservado, y Res. = lo reservado.
// Los productos «A pedido» no tienen disponible: solo muestran lo que se reserva (la cantidad de la línea).
export function StockLinea({ linea }: PropsLinea) {
  if (linea.a_pedido) {
    return (
      <Typography variant="caption" component="span" sx={{ lineHeight: 1.5 }}>
        Res. <b>{linea.cantidad}</b>
      </Typography>
    )
  }
  return (
    <Typography variant="caption" component="span" sx={{ lineHeight: 1.5 }}>
      Disp. <b>{disponibleDeLinea(linea)}</b>
      <br />
      Res. <b>{linea.reservado}</b>
    </Typography>
  )
}

// «A pedido · no descuenta stock» (FR-017).
export function EtiquetaAPedido({ linea }: PropsLinea) {
  return linea.a_pedido ? <EtiquetaEstado texto={ETIQUETA_A_PEDIDO} variante="info" /> : null
}

// Aviso de faltante (FR-018): una cantidad mayor al disponible del depósito. No impide guardar el borrador;
// la confirmación (F-VTA-07) lo vuelve a verificar en la base.
export function FaltanteAviso({ linea }: PropsLinea) {
  if (!hayFaltante(linea)) return null
  return (
    <Alert severity="error" role="alert" sx={{ py: 0.5 }}>
      {mensajeFaltante(linea)}
    </Alert>
  )
}
