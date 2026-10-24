import { Box, Breadcrumbs, Typography } from '@mui/material'
import { Link as EnlaceRuta, useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ordenarSeccionesCatalogo, type ModuloSeccionCatalogo } from '../seccionesCatalogo'
import { ErrorConReintento } from '../ErrorConReintento'

// `/categoria/:categoriaId` (F-TDA-11, FR-006/FR-007): se resuelve contra las categorías visibles de
// ESTA tienda. Inexistente, oculta, de otra empresa o con un id inválido → la misma 404 amable.
export default function RutaCategoria({ modulos }: { modulos?: Record<string, ModuloSeccionCatalogo> }) {
  const { tienda, host, categorias } = useContextoTienda()
  const { categoriaId } = useParams()

  if (categorias.fase === 'cargando') return <EstadoCargaPagina />
  if (categorias.fase === 'error') {
    return <ErrorConReintento titulo="No pudimos cargar la categoría." alReintentar={categorias.reintentar} />
  }
  const categoria = categoriaId ? categorias.categorias.find((c) => c.id === categoriaId) : undefined
  if (!categoria) return <PaginaNoEncontrada />

  const secciones = ordenarSeccionesCatalogo(modulos)
  return (
    <Box>
      <Breadcrumbs aria-label="Migas de pan" sx={{ mb: 1 }}>
        <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit' }}>Inicio</Box>
        <Typography color="text.primary" aria-current="page">{categoria.nombre}</Typography>
      </Breadcrumbs>
      <Typography component="h1" variant="h4" sx={{ mb: 2 }}>{categoria.nombre}</Typography>
      {secciones.map(({ clave, Componente }) => (
        <Componente key={clave} tienda={tienda} host={host} categoriaId={categoria.id} />
      ))}
    </Box>
  )
}
