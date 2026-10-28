import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useCategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { useInicioTienda } from '../../../lib/tiendaInicio'
import type { PropsSeccionTienda } from '../PaginaTienda'
import { ErrorConReintento } from '../ErrorConReintento'

export const orden = 40

const cantidad = (n: number) => (n === 1 ? '1 producto' : `${n} productos`)

// Bloque «Categorías» de la home (F-TDA-10, FR-003): una tarjeta por categoría visible, en el orden de
// Catálogo, con «N productos» (incluido «0 productos»), que enlaza a su listado. Se oculta cuando la tienda
// no tiene productos visibles (ahí manda «Catálogo en preparación»). Un error queda en este bloque.
export default function CategoriasInicio({ host }: PropsSeccionTienda) {
  const categorias = useCategoriasTienda(host)
  const inicio = useInicioTienda(host)

  if (categorias.fase === 'cargando' || inicio.fase === 'cargando') {
    return <Box component="section" aria-label="Categorías" sx={{ mt: 4 }}><EstadoCargaPagina lineas={2} /></Box>
  }
  if (categorias.fase === 'error') {
    return (
      <Box component="section" aria-label="Categorías" sx={{ mt: 4 }}>
        <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
      </Box>
    )
  }
  // Si el dato de preparación falló, no se oculta el bloque: las categorías ya cargaron por su cuenta.
  if ((inicio.fase === 'lista' && !inicio.hayProductos) || categorias.categorias.length === 0) return null

  return (
    <Box component="section" aria-labelledby="categorias-inicio-titulo" sx={{ mt: 4 }}>
      <Typography id="categorias-inicio-titulo" component="h2" variant="h5" sx={{ mb: 2 }}>Categorías</Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
      >
        {categorias.categorias.map((c) => (
          <li key={c.id}>
            <Box
              component={EnlaceRuta}
              to={`/categoria/${c.id}`}
              sx={{
                display: 'flex', flexDirection: 'column', gap: 0.5, p: 2, height: '100%', boxSizing: 'border-box',
                color: 'inherit', textDecoration: 'none', border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`,
                '&:hover, &:focus-visible': { borderColor: 'text.primary' },
              }}
            >
              <Typography component="span" sx={{ fontWeight: 600 }}>{c.nombre}</Typography>
              <Typography component="span" variant="body2" color="text.secondary">{cantidad(c.productos)}</Typography>
            </Box>
          </li>
        ))}
      </Box>
    </Box>
  )
}
