import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useInicioTienda } from '../../../lib/tiendaInicio'
import { GrillaProductos } from '../catalogo/GrillaProductos'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'
import type { PropsSeccionTienda } from '../PaginaTienda'
import { useCategoriaInicio } from './categoriaInicio'
import { ErrorConReintento } from '../ErrorConReintento'

export const orden = 50

// Bloque «Destacados» de la home (F-TDA-10, FR-004/FR-005): tarjetas del catálogo con el precio final de
// la empresa (reemplaza la lista mínima de MSF-147, que leía `precio_lista`). Sin destacados, o con la
// tienda en preparación, no se muestra. Un error queda en este bloque y no afecta al resto.
export default function DestacadosInicio({ host }: PropsSeccionTienda) {
  const inicio = useInicioTienda(host)
  // Celular: la píldora de categoría elegida en «Categorías» filtra los destacados en su lugar (prototipo `MJC_M_Home`).
  const categoria = useCategoriaInicio()

  if (inicio.fase === 'cargando') {
    return <Box component="section" aria-label="Destacados" sx={{ pt: 4 }}><EstadoCargaPagina lineas={2} /></Box>
  }
  if (inicio.fase === 'error') {
    return (
      <Box component="section" aria-label="Destacados" sx={{ pt: 4 }}>
        <ErrorConReintento titulo="No pudimos cargar los destacados." alReintentar={inicio.reintentar} />
      </Box>
    )
  }
  if (!inicio.hayProductos || inicio.destacados.length === 0) return null

  const visibles = categoria ? inicio.destacados.filter((p) => p.categoriaId !== null && categoria.ids.has(p.categoriaId)) : inicio.destacados
  return (
    <Box component="section" aria-labelledby="destacados-titulo" sx={{ pt: { xs: '8px', md: '40px' }, pb: { xs: '24px', md: '24px' } /* estilos-sueltos: ok */ }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: { xs: '14px', md: '20px' } /* estilos-sueltos: ok */ }}>
        <Typography id="destacados-titulo" component="h2" variant="h5" sx={{ fontSize: { xs: 26, md: 32 }, mt: { xs: '12px', md: 0 } /* estilos-sueltos: ok */ }}>{categoria ? categoria.nombre : 'Destacados'}</Typography>
        <Box component={EnlaceRuta} to="/catalogo" sx={{ display: { xs: 'none', md: 'inline' }, color: 'primary.main', fontWeight: 600, textDecoration: 'none' }}>Ver todo el catálogo →</Box>
      </Box>
      {visibles.length === 0 && categoria ? (
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          Todavía no hay destacados en {categoria.nombre}.{' '}
          <Box component={EnlaceRuta} to={`/categoria/${categoria.id}`} sx={{ color: 'primary.main', fontWeight: 600 }}>Ver {categoria.nombre}</Box>
        </Typography>
      ) : (
        <GrillaProductos columnas={4}>
          {visibles.map((p) => (
            <li key={p.id}>
              <TarjetaProducto producto={p} urlImagen={p.imagen ? inicio.imagenes[p.imagen] : undefined} />
            </li>
          ))}
        </GrillaProductos>
      )}
      {/* Celular (MJC_M_Home): el enlace al catálogo es un botón con borde debajo de la grilla. */}
      <Box
        component={EnlaceRuta}
        to="/catalogo"
        sx={{ display: { xs: 'block', md: 'none' }, textAlign: 'center', border: '2px solid', borderColor: 'primary.main', color: 'primary.main', fontWeight: 700, p: '12px', borderRadius: '8px', mt: '20px', textDecoration: 'none' /* estilos-sueltos: ok */ }}
      >
        Ver todo el catálogo
      </Box>
    </Box>
  )
}
