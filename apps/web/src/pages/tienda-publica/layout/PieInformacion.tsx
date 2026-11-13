import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { useEnlacesPaginas } from '../../../hooks/useEnlacesPaginas'
import { TOPE_PAGINAS_EMPRESA } from '../../../lib/tiendaPaginas'
import { estiloEnlacePie, estiloTituloPie } from './estilosPie'

// Columna «Información» del pie (F-TDA-23, FR-007): un enlace por página visible de ESTA tienda, en el mismo
// estilo que «Categorías». Sin páginas visibles (o si el pedido falla) no se muestra: sin hueco ni error propio.
// La base limita a 50 páginas por empresa; acá también se acota la lista (defensa en profundidad) y, cuando son muchas,
// se reparte en columnas para no alargar el pie.
export function PieInformacion({ host }: { host: string }) {
  const paginas = useEnlacesPaginas(host).slice(0, TOPE_PAGINAS_EMPRESA)
  if (paginas.length === 0) return null
  return (
    <Box component="nav" aria-label="Información del pie" data-testid="pie-informacion">
      <Typography component="h2" sx={estiloTituloPie}>
        Información
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, fontSize: 14 /* estilos-sueltos: ok */, ...(paginas.length > 8 ? { columnWidth: '12rem', columnGap: 3, maxWidth: '40rem' } : {}) }}
      >
        {paginas.map((pagina) => (
          <Box component="li" key={pagina.slug} sx={{ breakInside: 'avoid' }}>
            <Box component={EnlaceRuta} to={`/pagina/${pagina.slug}`} sx={estiloEnlacePie}>
              {pagina.titulo}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
