import type { MouseEvent } from 'react'
import { Alert, AlertTitle, Button } from '@mui/material'
import { MENSAJE_SIN_STOCK } from '../../lib/reparacionItems'

type Props = {
  // Unidades disponibles en el depósito elegido; nulo si no se pudo consultar.
  disponible: number | null
  deshabilitado: boolean
  onDejarPendiente: (evento: MouseEvent<HTMLButtonElement>) => void
}

// Aviso del diálogo «Agregar repuesto» ante «No hay stock suficiente» (F-SVC-12, FR-030): muestra el disponible y
// ofrece cargar el repuesto igual, pendiente de stock y sin descontar.
export function AvisoSinStock({ disponible, deshabilitado, onDejarPendiente }: Props) {
  const detalle = disponible === null ? '' : ` Disponible: ${disponible} u.`
  return (
    <Alert
      severity="warning"
      role="alert"
      action={<Button color="inherit" size="small" disabled={deshabilitado} onClick={onDejarPendiente}>Dejar pendiente</Button>}
    >
      <AlertTitle>{MENSAJE_SIN_STOCK}</AlertTitle>
      {`${detalle} Podés dejarlo pendiente: se suma al presupuesto y no descuenta stock.`.trim()}
    </Alert>
  )
}
