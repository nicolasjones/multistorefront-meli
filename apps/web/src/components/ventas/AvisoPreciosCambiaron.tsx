import { Alert } from '@mui/material'

// Aviso compartido «Los precios cambiaron» (F-2, FR-017/FR-018, prototipo `VentasComprobante`). Es informativo
// (`role="status"`): no bloquea el siguiente escaneo ni el cobro; al cobrar, además, la base ya rechazó sin efectos.
export function AvisoPreciosCambiaron({ mensaje }: { mensaje: string }) {
  return (
    <Alert severity="info" role="status">
      {mensaje}
    </Alert>
  )
}
