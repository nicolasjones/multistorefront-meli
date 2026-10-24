import { Box, Link } from '@mui/material'
import { Link as EnlaceRuta, useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useFichaProducto } from '../../../hooks/useFichaProducto'
import { Compatibilidad } from '../ficha/Compatibilidad'
import { DatosProducto, Migas } from '../ficha/DatosProducto'
import { Galeria } from '../ficha/Galeria'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ErrorConReintento } from '../ErrorConReintento'

// `/producto/:productoId` (F-TDA-13, FR-051/FR-056): ficha del producto de ESTA tienda. Inexistente,
// inactivo, oculto, de categoría oculta, de otra empresa o con un id inválido → la misma 404 amable.
// `/producto` sin id tampoco existe.
export default function RutaProducto() {
  const { host } = useContextoTienda()
  const { productoId } = useParams()
  const ficha = useFichaProducto(host, productoId ?? '')

  if (!productoId) return <PaginaNoEncontrada />
  if (ficha.fase === 'cargando') return <EstadoCargaPagina />
  if (ficha.fase === 'error') {
    return <ErrorConReintento titulo="No pudimos cargar el producto." alReintentar={ficha.reintentar} />
  }
  if (ficha.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const { ficha: datos, urls } = ficha
  return (
    <Box>
      {/* Celular (F-TDA-17, FR-042): enlace de vuelta arriba; las migas son de escritorio. */}
      <Link component={EnlaceRuta} to="/catalogo" underline="hover" sx={{ display: { xs: 'inline-flex', md: 'none' }, alignItems: 'center', minHeight: 44, mb: 1, color: 'inherit' }}>
        ← Todos los productos
      </Link>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}><Migas nombre={datos.nombre} /></Box>
      <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        <Galeria key={datos.id} imagenes={datos.imagenes} urls={urls} nombre={datos.nombre} />
        <Box>
          <DatosProducto ficha={datos} />
          <Compatibilidad compatibilidad={datos.compatibilidad} />
        </Box>
      </Box>
    </Box>
  )
}
