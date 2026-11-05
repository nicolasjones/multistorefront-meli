import { Box, Skeleton, Typography } from '@mui/material'
import { useRelacionados } from '../../../lib/tiendaRelacionados'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'

// «Productos relacionados» de la ficha (F-TDA-20, FR-011/FR-012): hasta 4 de la misma categoría, en 4
// columnas en escritorio y 2 en celular. Sin relacionados, o si el pedido falla, no se renderiza nada
// (ni título ni hueco ni mensaje de error: la ficha sigue intacta). Mientras carga, un estado discreto.
export default function Relacionados({ host, productoId }: { host: string; productoId: string }) {
  const estado = useRelacionados(host, productoId)
  if (estado.fase === 'vacia' || estado.fase === 'error') return null

  const columnas = { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }
  if (estado.fase === 'cargando') {
    return (
      <Box data-testid="relacionados-cargando" aria-hidden sx={{ mt: 6, display: 'grid', gap: 2, gridTemplateColumns: columnas }}>
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} variant="rounded" height={160} />)}
      </Box>
    )
  }
  return (
    <Box component="section" aria-labelledby="titulo-relacionados" sx={{ mt: 6 }}>
      <Typography id="titulo-relacionados" component="h2" variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
        Productos relacionados
      </Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: columnas }}>
        {estado.productos.map((producto) => (
          <TarjetaProducto key={producto.id} producto={producto} urlImagen={producto.imagen ? estado.imagenes[producto.imagen] : undefined} />
        ))}
      </Box>
    </Box>
  )
}
