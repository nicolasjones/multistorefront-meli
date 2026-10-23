import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import type { CategoriaPublica } from '../../../lib/tiendaCategorias'

// Columna «Categorías» del pie (F-TDA-11, FR-005): las mismas categorías y enlaces que el menú. Sin
// categorías visibles no se muestra la columna.
export function PieCategorias({ categorias }: { categorias: CategoriaPublica[] }) {
  if (categorias.length === 0) return null
  return (
    <Box component="nav" aria-labelledby="pie-categorias-titulo" data-testid="pie-categorias">
      <Typography id="pie-categorias-titulo" component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
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
  )
}
