import { Alert, Box } from '@mui/material'

type Props = {
  /** Texto del aviso; `null` = sin aviso (la región viva igual queda en el DOM). */
  mensaje: string | null
  /** Separación superior del aviso (unidades del tema) cuando el contenedor es un `Stack` con ese `spacing`. */
  separacion?: number
}

// Aviso compartido «Los precios cambiaron» (F-2, FR-017/FR-018, prototipo `VentasComprobante`). Es informativo: no
// bloquea el siguiente escaneo ni la confirmación y no roba el foco. La región viva (`role="status"`) existe SIEMPRE y
// el texto se le inserta después: los lectores de pantalla solo anuncian lo que aparece en una región ya presente.
// `display: contents` evita que la región vacía sume un hueco entre los hijos del `Stack` (la pantalla sin aviso queda
// idéntica a la anterior); el `Alert` va con `role="none"` para no anidar un segundo `role="alert"` dentro de la región.
export function AvisoPreciosCambiaron({ mensaje, separacion = 2 }: Props) {
  return (
    <Box role="status" aria-live="polite" data-testid="aviso-precios" sx={{ display: 'contents' }}>
      {mensaje ? (
        <Alert severity="info" role="none" sx={{ mt: separacion }}>
          {mensaje}
        </Alert>
      ) : null}
    </Box>
  )
}
