import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoCargaPagina, EstadoError } from '../../../components/estados/EstadosPagina'
import { useInicioTienda } from '../../../lib/tiendaInicio'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'
import type { PropsSeccionTienda } from '../PaginaTienda'

export const orden = 50

// Bloque «Destacados» de la home (F-TDA-10, FR-004/FR-005): tarjetas del catálogo con el precio final de
// la empresa (reemplaza la lista mínima de MSF-147, que leía `precio_lista`). Sin destacados, o con la
// tienda en preparación, no se muestra. Un error queda en este bloque y no afecta al resto.
export default function DestacadosInicio({ host }: PropsSeccionTienda) {
  const inicio = useInicioTienda(host)

  if (inicio.fase === 'cargando') {
    return <Box component="section" aria-label="Destacados" sx={{ mt: 4 }}><EstadoCargaPagina lineas={2} /></Box>
  }
  if (inicio.fase === 'error') {
    return (
      <Box component="section" aria-label="Destacados" sx={{ mt: 4 }}>
        <EstadoError titulo="No pudimos cargar los destacados." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={inicio.reintentar} />
      </Box>
    )
  }
  if (!inicio.hayProductos || inicio.destacados.length === 0) return null

  return (
    <Box component="section" aria-labelledby="destacados-titulo" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography id="destacados-titulo" component="h2" variant="h5">Destacados</Typography>
        <Box component={EnlaceRuta} to="/catalogo" sx={{ color: 'primary.main' }}>Ver todo el catálogo →</Box>
      </Box>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
      >
        {inicio.destacados.map((p) => (
          <li key={p.id}>
            <TarjetaProducto producto={p} urlImagen={p.imagen ? inicio.imagenes[p.imagen] : undefined} />
          </li>
        ))}
      </Box>
    </Box>
  )
}
