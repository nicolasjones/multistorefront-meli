import { Box } from '@mui/material'
import { NavLink } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { categoriasPrincipales, hayMasCategorias } from '../../../lib/tiendaCategorias'
import { ErrorConReintento } from '../ErrorConReintento'

// Barra de categorías (prototipo MJC_Home): en mayúsculas, 15 px, 600, con subrayado de 3 px en la activa (color primario).
const estiloEnlace = {
  display: 'inline-block',
  whiteSpace: 'nowrap',
  py: '14px',
  px: '4px',
  color: 'text.primary',
  textDecoration: 'none',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  fontSize: 15, // estilos-sueltos: ok
  fontWeight: 600,
  borderBottom: 3,
  borderColor: 'transparent',
  '&:hover, &:focus-visible': { borderColor: 'divider' },
  '&[aria-current="page"]': { borderColor: 'primary.main' },
} as const

// Barra de categorías del encabezado (F-TDA-11, FR-004/FR-008): una entrada por categoría principal y «Más categorías».
// «Inicio» y «Contacto» (F-TDA-16, FR-010) viven en la fila de la marca (MSF-841, como el prototipo). Es una lista de
// enlaces (teclado nativo); NavLink marca con aria-current la ruta actual. Sin categorías no hay barra; si la
// lectura falla, un aviso con «Reintentar». Desde celular (< md) lo reemplaza `MenuMovil` (F-TDA-17, FR-040).
// MSF-825 (MSF-826): en UNA línea, con las categorías principales de la tienda (las de mayor cantidad, hasta 6;
// la tienda oculta las que no quiere desde su configuración) y «Más categorías» hacia el catálogo con el resto;
// ya no se listan las ~190 de la base.
export function MenuCategorias({ categorias }: { categorias: CategoriasTienda }) {
  const principales = categoriasPrincipales(categorias.categorias)
  if (categorias.fase === 'lista' && principales.length === 0) return null
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' }, bgcolor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,.08)' /* estilos-sueltos: ok */ }}>
      <Box component="nav" aria-label="Categorías" aria-busy={categorias.fase === 'cargando'} sx={{ maxWidth: 1200, mx: 'auto', px: 2, minHeight: 52 /* estilos-sueltos: ok */ }}>
        <Box component="ul" sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: '28px', listStyle: 'none', m: 0, p: 0, alignItems: 'center' }}>
          {principales.map((categoria) => (
            <li key={categoria.id}>
              <Box component={NavLink} to={`/categoria/${categoria.id}`} sx={estiloEnlace}>{categoria.nombre}</Box>
            </li>
          ))}
          {hayMasCategorias(categorias.categorias, principales) ? (
            <li><Box component={NavLink} to="/catalogo" end sx={estiloEnlace}>Más categorías</Box></li>
          ) : null}
          {categorias.fase === 'error' && (
            <li>
              <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
            </li>
          )}
        </Box>
      </Box>
    </Box>
  )
}
