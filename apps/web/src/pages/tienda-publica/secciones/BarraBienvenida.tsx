import { Box, Typography } from '@mui/material'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import type { PropsSeccionTienda } from '../PaginaTienda'

// Antes que el resto de las secciones: es la barra superior (F-TDA-03, FR-034/FR-036).
export const orden = 10

// Mensaje de bienvenida de la barra superior. Texto plano (React lo escapa); vacío → no se
// muestra la barra.
export default function BarraBienvenida({ host }: PropsSeccionTienda) {
  const contenido = useContenidoPublico(host)
  const texto = contenido?.bienvenida.trim()
  if (!texto) return null
  return (
    <Box data-testid="barra-bienvenida" sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1, textAlign: 'center' }}>
      <Typography variant="body2">{texto}</Typography>
    </Box>
  )
}
