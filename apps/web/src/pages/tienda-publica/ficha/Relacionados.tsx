import { Box, Skeleton, Typography } from '@mui/material'
import { useRelacionados } from '../../../lib/tiendaRelacionados'
import { GrillaProductos } from '../catalogo/GrillaProductos'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'

// «Productos relacionados» de la ficha (F-TDA-20, FR-011/FR-012): hasta 4 de la misma categoría, en 4
// columnas en escritorio y 2 en celular. Sin relacionados, o si el pedido falla, no se renderiza nada
// (ni título ni hueco ni mensaje de error: la ficha sigue intacta). Mientras carga, un estado discreto.
export default function Relacionados({ host, productoId }: { host: string; productoId: string }) {
  const estado = useRelacionados(host, productoId)
  if (estado.fase === 'vacia' || estado.fase === 'error') return null

  if (estado.fase === 'cargando') {
    return (
      <GrillaProductos columnas={4} data-testid="relacionados-cargando" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <li key={i}><Skeleton variant="rounded" height={160} /></li>)}
      </GrillaProductos>
    )
  }
  // Prototipo: título de 32 px (24 px en celular) con 20 px (14 px) de aire y 56 px (24 px) de cierre.
  return (
    <Box component="section" aria-labelledby="titulo-relacionados" sx={{ pt: { xs: '24px', md: 0 }, pb: { xs: '24px', md: '56px' } /* estilos-sueltos: ok */ }}>
      <Typography id="titulo-relacionados" component="h2" variant="h5" sx={{ fontSize: { xs: 24, md: 32 }, mb: { xs: '14px', md: '20px' } /* estilos-sueltos: ok */ }}>
        Productos relacionados
      </Typography>
      <GrillaProductos columnas={4}>
        {estado.productos.map((producto) => (
          <li key={producto.id}>
            <TarjetaProducto producto={producto} urlImagen={producto.imagen ? estado.imagenes[producto.imagen] : undefined} />
          </li>
        ))}
      </GrillaProductos>
    </Box>
  )
}
