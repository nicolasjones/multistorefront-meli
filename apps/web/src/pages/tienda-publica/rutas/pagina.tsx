import { Box, Breadcrumbs, Typography } from '@mui/material'
import { Link as EnlaceRuta, useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { usePaginaTienda } from '../../../hooks/usePaginaTienda'
import { aParrafos } from '../../../lib/tiendaPaginas'
import { useContextoTienda } from '../layout/LayoutTienda'
import { CabeceraSeo } from '../seo/CabeceraSeo'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ErrorConReintento } from '../ErrorConReintento'

// `/pagina/:slug` (F-TDA-23, FR-006): página de contenido de ESTA tienda como texto plano (línea en blanco =
// párrafo; saltos simples respetados; nunca HTML). Inexistente, oculta, de otra empresa o tienda pausada → la
// misma 404 de la tienda (no revela existencia). `/pagina` sin slug también es 404.
// El parámetro se llama `paginaId` por la convención de archivos de `rutas/` (ver LEEME.md): vale el slug.
export default function RutaPagina() {
  const { host } = useContextoTienda()
  const { paginaId = '' } = useParams()
  const pagina = usePaginaTienda(host, paginaId)
  if (!paginaId) return <PaginaNoEncontrada />
  if (pagina.fase === 'cargando') return <EstadoCargaPagina />
  if (pagina.fase === 'error') {
    return (
      <>
        {/* FR-004/FR-024: una pantalla de error no se indexa. */}
        <CabeceraSeo noindex pagina="No pudimos cargar esta página" />
        <ErrorConReintento alReintentar={pagina.reintentar} />
      </>
    )
  }
  if (pagina.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const { titulo: nombre, contenido } = pagina.pagina
  return (
    <Box>
      {/* Cabecera SEO compartida (MSF-149): título «<página> | <empresa>», descripción de la tienda, canónica y Open Graph. */}
      <CabeceraSeo host={host} pagina={nombre} ruta={`/pagina/${paginaId}`} />
      <Breadcrumbs aria-label="Migas de pan" sx={{ mb: 2 }}>
        <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit' }}>Inicio</Box>
        <Typography color="text.primary" aria-current="page" sx={{ overflowWrap: 'anywhere' }}>{nombre}</Typography>
      </Breadcrumbs>
      <Typography component="h1" variant="h4" sx={{ typography: { xs: 'h5', md: 'h4' }, overflowWrap: 'anywhere', mb: 2 }}>{nombre}</Typography>
      <Box data-testid="pagina-contenido" sx={{ maxWidth: '70ch' }}>
        {aParrafos(contenido).map((parrafo, indice) => (
          <Typography key={indice} sx={{ mb: 2, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{parrafo}</Typography>
        ))}
      </Box>
    </Box>
  )
}
