import { Box } from '@mui/material'
import { NavLink } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { categoriasPrincipales, hayMasCategorias } from '../../../lib/tiendaCategorias'
import { ErrorConReintento } from '../ErrorConReintento'

const estiloEnlace = {
  display: 'inline-block',
  whiteSpace: 'nowrap',
  px: 1.5,
  py: 1,
  color: 'inherit',
  textDecoration: 'none',
  borderBottom: 2,
  borderColor: 'transparent',
  '&:hover, &:focus-visible': { borderColor: 'divider' },
  '&[aria-current="page"]': { fontWeight: 700, borderColor: 'var(--tienda-color-primario, currentColor)' },
} as const

// Menú del encabezado (F-TDA-11, FR-004/FR-008): «Inicio», una entrada por categoría visible y «Contacto»
// (F-TDA-16, FR-010). Es una
// lista de enlaces (teclado nativo); NavLink marca con aria-current la ruta actual. Sin categorías
// queda solo «Inicio», sin error; si la lectura falla, «Inicio» y un aviso con «Reintentar». Desde
// celular (< md) lo reemplaza `MenuMovil` (F-TDA-17, FR-040).
// MSF-825 (MSF-826): en UNA línea, con las categorías principales de la tienda (las de mayor cantidad, hasta 6;
// la tienda oculta las que no quiere desde su configuración) y «Más categorías» hacia el catálogo con el resto;
// ya no se listan las ~190 de la base.
export function MenuCategorias({ categorias }: { categorias: CategoriasTienda }) {
  const principales = categoriasPrincipales(categorias.categorias)
  return (
    <Box component="nav" aria-label="Categorías" aria-busy={categorias.fase === 'cargando'} sx={{ display: { xs: 'none', md: 'block' } }}>
      <Box component="ul" sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 0.5, listStyle: 'none', m: 0, p: 0, alignItems: 'center' }}>
        <li><Box component={NavLink} to="/" end sx={estiloEnlace}>Inicio</Box></li>
        {principales.map((categoria) => (
          <li key={categoria.id}>
            <Box component={NavLink} to={`/categoria/${categoria.id}`} sx={estiloEnlace}>{categoria.nombre}</Box>
          </li>
        ))}
        {hayMasCategorias(categorias.categorias, principales) ? (
          <li><Box component={NavLink} to="/catalogo" end sx={estiloEnlace}>Más categorías</Box></li>
        ) : null}
        <li><Box component={NavLink} to="/contacto" sx={estiloEnlace}>Contacto</Box></li>
        {categorias.fase === 'error' && (
          <li>
            <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
          </li>
        )}
      </Box>
    </Box>
  )
}
