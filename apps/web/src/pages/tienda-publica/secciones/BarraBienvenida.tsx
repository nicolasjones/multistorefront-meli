import { Box, Typography } from '@mui/material'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { textoBarra } from '../layout/BarraSuperior'
import { useEnLayout } from '../layout/enLayout'
import type { PropsSeccionTienda } from '../PaginaTienda'

// Antes que el resto de las secciones: es la barra superior (F-TDA-03, FR-034/FR-036).
export const orden = 10

// Mensaje de bienvenida. Texto plano (React lo escapa); vacío → no se muestra la franja.
// MSF-841: en la tienda, la barra superior del layout muestra el eslogan o, sin eslogan, esta bienvenida. Esta franja
// solo queda cuando hay eslogan Y una bienvenida distinta (si no, el mismo texto saldría dos veces). En la vista previa
// del panel (sin layout) se muestra como antes.
export default function BarraBienvenida({ host }: PropsSeccionTienda) {
  const contenido = useContenidoPublico(host)
  const enLayout = useEnLayout()
  const texto = contenido?.bienvenida.trim()
  if (!texto) return null
  if (enLayout && texto === textoBarra(contenido)) return null
  return (
    <Box data-testid="barra-bienvenida" sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1, textAlign: 'center' }}>
      <Typography variant="body2">{texto}</Typography>
    </Box>
  )
}
