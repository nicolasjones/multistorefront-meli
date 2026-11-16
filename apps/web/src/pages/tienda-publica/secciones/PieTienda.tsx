import { Box, Typography } from '@mui/material'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { useEnLayout } from '../layout/enLayout'
import type { PropsSeccionTienda } from '../PaginaTienda'

// Al final de la página (F-TDA-03, FR-034/FR-036).
export const orden = 900

// Texto del pie de página. Texto plano (React lo escapa); vacío → no se muestra el pie. MSF-841: en la tienda lo
// muestra el pie oscuro del layout en TODAS las páginas (no solo la portada); acá queda para la vista previa del panel.
export default function PieTienda({ host }: PropsSeccionTienda) {
  const contenido = useContenidoPublico(host)
  const enLayout = useEnLayout()
  const texto = contenido?.pie.trim()
  if (!texto || enLayout) return null
  return (
    <Box component="footer" data-testid="pie-tienda" sx={{ borderTop: 1, borderColor: 'divider', px: 2, py: 2, mt: 4 }}>
      <Typography variant="body2" color="text.secondary">{texto}</Typography>
    </Box>
  )
}
