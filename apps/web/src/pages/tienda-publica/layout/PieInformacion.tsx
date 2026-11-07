import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { useEnlacesPaginas } from '../../../hooks/useEnlacesPaginas'

// Columna «Información» del pie (F-TDA-23, FR-007): un enlace por página visible de ESTA tienda, en el mismo
// estilo que «Categorías». Sin páginas visibles (o si el pedido falla) no se muestra: sin hueco ni error propio.
export function PieInformacion({ host }: { host: string }) {
  const paginas = useEnlacesPaginas(host)
  if (paginas.length === 0) return null
  return (
    <Box component="nav" aria-label="Información del pie" data-testid="pie-informacion">
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Información
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {paginas.map((pagina) => (
          <li key={pagina.slug}>
            <Box component={EnlaceRuta} to={`/pagina/${pagina.slug}`} sx={{ color: 'inherit', display: 'inline-block', py: 0.5, overflowWrap: 'anywhere' }}>
              {pagina.titulo}
            </Box>
          </li>
        ))}
      </Box>
    </Box>
  )
}
