import { Box } from '@mui/material'
import { useParams } from 'react-router'
import { EstadoCargaPagina, EstadoError } from '../../../components/estados/EstadosPagina'
import { useFichaProducto } from '../../../hooks/useFichaProducto'
import { usePreciosCliente } from '../../../hooks/usePreciosCliente'
import { Compatibilidad } from '../ficha/Compatibilidad'
import { DatosProducto, Migas } from '../ficha/DatosProducto'
import { Galeria } from '../ficha/Galeria'
import { PreciosCliente } from '../ficha/PreciosCliente'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'

// `/producto/:productoId` (F-TDA-13, FR-051/FR-056): ficha del producto de ESTA tienda. Inexistente,
// inactivo, oculto, de categoría oculta, de otra empresa o con un id inválido → la misma 404 amable.
// `/producto` sin id tampoco existe.
export default function RutaProducto() {
  const { host } = useContextoTienda()
  const { productoId } = useParams()
  const ficha = useFichaProducto(host, productoId ?? '')
  const preciosCliente = usePreciosCliente(host, productoId ?? '')

  if (!productoId) return <PaginaNoEncontrada />
  if (ficha.fase === 'cargando') return <EstadoCargaPagina />
  if (ficha.fase === 'error') {
    return <EstadoError titulo="No pudimos cargar el producto." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={ficha.reintentar} />
  }
  if (ficha.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const { ficha: datos, urls } = ficha
  return (
    <Box>
      <Migas nombre={datos.nombre} />
      <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        <Galeria key={datos.id} imagenes={datos.imagenes} urls={urls} nombre={datos.nombre} />
        <Box>
          <DatosProducto ficha={datos} />
          {preciosCliente ? <PreciosCliente precios={preciosCliente} /> : null}
          <Compatibilidad compatibilidad={datos.compatibilidad} />
        </Box>
      </Box>
    </Box>
  )
}
