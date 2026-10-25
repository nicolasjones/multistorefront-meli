import { Box, Breadcrumbs, Typography } from '@mui/material'
import { Link as EnlaceRuta, useParams, useSearchParams } from 'react-router'
import { normalizarConsulta } from '../../../lib/tiendaBusqueda'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ordenarSeccionesCatalogo, type ModuloSeccionCatalogo } from '../seccionesCatalogo'

// `/catalogo` (F-TDA-12, FR-035/FR-040): «Todos los productos» con el listado de `secciones-catalogo/`.
// La categoría, los filtros, el orden y la página viven en la query de la URL.
export default function RutaCatalogo({ modulos }: { modulos?: Record<string, ModuloSeccionCatalogo> }) {
  const { tienda, host } = useContextoTienda()
  const { catalogoId } = useParams()
  const [params] = useSearchParams()
  // `/catalogo/<algo>` no existe: la misma 404 amable.
  if (catalogoId !== undefined) return <PaginaNoEncontrada />

  // Con `?q=` es la página de resultados de la búsqueda (F-TDA-15, FR-025); el texto va como nodo de
  // React (se escapa solo).
  const q = normalizarConsulta(params.get('q'))
  const titulo = q ? `Resultados para “${q}”` : 'Todos los productos'
  const miga = q ? 'Resultados' : 'Todos los productos'
  const secciones = ordenarSeccionesCatalogo(modulos)
  return (
    <Box>
      <Breadcrumbs aria-label="Migas de pan" sx={{ mb: 1 }}>
        <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit' }}>Inicio</Box>
        <Typography color="text.primary" aria-current="page">{miga}</Typography>
      </Breadcrumbs>
      <Typography component="h1" variant="h4" sx={{ mb: 2 }}>{titulo}</Typography>
      {secciones.map(({ clave, Componente }) => (
        <Componente key={clave} tienda={tienda} host={host} categoriaId={null} />
      ))}
    </Box>
  )
}
