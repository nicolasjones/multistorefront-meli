import { Box, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { usePaginaTienda } from '../../../hooks/usePaginaTienda'
import { aParrafos } from '../../../lib/tiendaPaginas'
import { useContextoTienda } from '../layout/LayoutTienda'
import { MigasTienda } from '../layout/MigasTienda'
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
  if (pagina.fase === 'cargando') return <Box sx={{ py: 2 }}><EstadoCargaPagina /></Box>
  if (pagina.fase === 'error') {
    return (
      <Box sx={{ py: 2 }}>
        {/* FR-004/FR-024: una pantalla de error no se indexa. */}
        <CabeceraSeo noindex pagina="No pudimos cargar esta página" />
        <ErrorConReintento alReintentar={pagina.reintentar} />
      </Box>
    )
  }
  if (pagina.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const { titulo: nombre, contenido } = pagina.pagina
  return (
    <Box>
      {/* Cabecera SEO compartida (MSF-149): título «<página> | <empresa>», descripción de la tienda, canónica y Open Graph. */}
      <CabeceraSeo host={host} pagina={nombre} ruta={`/pagina/${paginaId}`} />
      <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: nombre }]} />
      <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 30, md: 44 }, overflowWrap: 'anywhere', mb: 2 /* estilos-sueltos: ok */ }}>{nombre}</Typography>
      <Box data-testid="pagina-contenido" sx={{ maxWidth: '70ch' }}>
        {aParrafos(contenido).map((parrafo, indice) => (
          <Typography key={indice} sx={{ mb: 2, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{parrafo}</Typography>
        ))}
      </Box>
    </Box>
  )
}
