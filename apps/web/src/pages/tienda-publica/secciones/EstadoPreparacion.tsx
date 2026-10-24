import { Box, Typography } from '@mui/material'
import { useInicioTienda } from '../../../lib/tiendaInicio'
import type { PropsSeccionTienda } from '../PaginaTienda'

export const orden = 30

// «Catálogo en preparación» (F-TDA-10, FR-006): tienda activa sin ningún producto visible. Reemplaza a los
// bloques «Categorías» y «Destacados» (que se ocultan solos) y no es un error. Con productos visibles
// pero sin destacados no aparece. Si el dato falla, cada bloque muestra su propio error.
export default function EstadoPreparacion({ host }: PropsSeccionTienda) {
  const inicio = useInicioTienda(host)
  if (inicio.fase !== 'lista' || inicio.hayProductos) return null
  return (
    <Box component="section" aria-labelledby="preparacion-titulo" role="status" data-testid="catalogo-en-preparacion" sx={{ mt: 4, py: 6, textAlign: 'center' }}>
      <Typography id="preparacion-titulo" component="h2" variant="h5" gutterBottom>Catálogo en preparación</Typography>
      <Typography color="text.secondary">Estamos cargando los productos. Volvé pronto.</Typography>
    </Box>
  )
}
