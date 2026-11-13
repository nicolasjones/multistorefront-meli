import { Box, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useContextoTienda } from '../layout/LayoutTienda'
import { MigasTienda } from '../layout/MigasTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { CabeceraSeo } from '../seo/CabeceraSeo'
import { ordenarSeccionesCatalogo, type ModuloSeccionCatalogo } from '../seccionesCatalogo'
import { ErrorConReintento } from '../ErrorConReintento'

// `/categoria/:categoriaId` (F-TDA-11, FR-006/FR-007): se resuelve contra las categorías visibles de
// ESTA tienda. Inexistente, oculta, de otra empresa o con un id inválido → la misma 404 amable.
export default function RutaCategoria({ modulos }: { modulos?: Record<string, ModuloSeccionCatalogo> }) {
  const { tienda, host, categorias } = useContextoTienda()
  const { categoriaId } = useParams()

  if (categorias.fase === 'cargando') return <Box sx={{ py: 2 }}><EstadoCargaPagina /></Box>
  if (categorias.fase === 'error') {
    return (
      <Box sx={{ py: 2 }}>
        <CabeceraSeo noindex pagina="No pudimos cargar la categoría" />
        <ErrorConReintento titulo="No pudimos cargar la categoría." alReintentar={categorias.reintentar} />
      </Box>
    )
  }
  const categoria = categoriaId ? categorias.categorias.find((c) => c.id === categoriaId) : undefined
  if (!categoria) return <PaginaNoEncontrada />

  const secciones = ordenarSeccionesCatalogo(modulos)
  return (
    <Box>
      <CabeceraSeo host={host} pagina={categoria.nombre} ruta={`/categoria/${categoria.id}`} />
      <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: categoria.nombre }]} />
      <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 30, md: 44 }, mb: { xs: '16px', md: '24px' } /* estilos-sueltos: ok */ }}>{categoria.nombre}</Typography>
      {secciones.map(({ clave, Componente }) => (
        <Componente key={clave} tienda={tienda} host={host} categoriaId={categoria.id} />
      ))}
    </Box>
  )
}
