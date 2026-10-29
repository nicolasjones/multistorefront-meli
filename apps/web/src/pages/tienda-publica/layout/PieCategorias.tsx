import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import type { CategoriaPublica } from '../../../lib/tiendaCategorias'

// Pie de la tienda: columna «Categorías» (F-TDA-11, FR-005: las mismas categorías y enlaces que el menú; sin
// categorías visibles no se muestra) y el enlace «Escribinos» a `/contacto` (F-TDA-16, FR-010), que está siempre.
export function PieCategorias({ categorias }: { categorias: CategoriaPublica[] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 3, md: 8 } }}>
      {categorias.length > 0 ? (
        <Box component="nav" aria-label="Categorías del pie" data-testid="pie-categorias">
          <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Categorías
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {categorias.map((categoria) => (
              <li key={categoria.id}>
                <Box component={EnlaceRuta} to={`/categoria/${categoria.id}`} sx={{ color: 'inherit', display: 'inline-block', py: 0.5 }}>
                  {categoria.nombre}
                </Box>
              </li>
            ))}
          </Box>
        </Box>
      ) : null}
      <Box component="nav" aria-label="Contacto del pie" data-testid="pie-contacto">
        <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Contacto
        </Typography>
        <Box component={EnlaceRuta} to="/contacto" sx={{ color: 'inherit', display: 'inline-block', py: 0.5 }}>
          Escribinos
        </Box>
      </Box>
    </Box>
  )
}
