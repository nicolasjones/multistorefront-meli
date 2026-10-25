import { Box } from '@mui/material'
import { NavLink } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { ErrorConReintento } from '../ErrorConReintento'

const estiloEnlace = {
  display: 'inline-block',
  px: 1.5,
  py: 1,
  color: 'inherit',
  textDecoration: 'none',
  borderBottom: 2,
  borderColor: 'transparent',
  '&:hover, &:focus-visible': { borderColor: 'divider' },
  '&[aria-current="page"]': { fontWeight: 700, borderColor: 'var(--tienda-color-primario, currentColor)' },
} as const

// Menú del encabezado (F-TDA-11, FR-004/FR-008): «Inicio» y una entrada por categoría visible. Es una
// lista de enlaces (teclado nativo); NavLink marca con aria-current la ruta actual. Sin categorías
// queda solo «Inicio», sin error; si la lectura falla, «Inicio» y un aviso con «Reintentar». Desde
// celular (< md) lo reemplaza `MenuMovil` (F-TDA-17, FR-040).
export function MenuCategorias({ categorias }: { categorias: CategoriasTienda }) {
  return (
    <Box component="nav" aria-label="Categorías" aria-busy={categorias.fase === 'cargando'} sx={{ display: { xs: 'none', md: 'block' } }}>
      <Box component="ul" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, listStyle: 'none', m: 0, p: 0, alignItems: 'center' }}>
        <li><Box component={NavLink} to="/" end sx={estiloEnlace}>Inicio</Box></li>
        {categorias.categorias.map((categoria) => (
          <li key={categoria.id}>
            <Box component={NavLink} to={`/categoria/${categoria.id}`} sx={estiloEnlace}>{categoria.nombre}</Box>
          </li>
        ))}
        {categorias.fase === 'error' && (
          <li>
            <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
          </li>
        )}
      </Box>
    </Box>
  )
}
