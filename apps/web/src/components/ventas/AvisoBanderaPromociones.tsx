import { Alert, Box } from '@mui/material'

type Props = {
  mensaje: string | null
  onCerrar: () => void
}

// MSF-937: aviso «las promociones se activaron/desactivaron» con una venta abierta. Región viva siempre presente
// (mismo patrón que `AvisoPreciosCambiaron`) y `warning` porque pide una acción del cajero; se puede cerrar.
export function AvisoBanderaPromociones({ mensaje, onCerrar }: Props) {
  return (
    <Box role="status" aria-live="polite" data-testid="aviso-bandera-promociones" sx={{ display: 'contents' }}>
      {mensaje ? (
        <Alert severity="warning" role="none" onClose={onCerrar} sx={{ mt: 2 }}>
          {mensaje}
        </Alert>
      ) : null}
    </Box>
  )
}
