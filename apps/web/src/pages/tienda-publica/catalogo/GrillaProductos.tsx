import type { ReactNode } from 'react'
import { Box } from '@mui/material'

// Grilla fluida de tarjetas de producto (MSF-847). Equivale a las medidas del prototipo en escritorio —4 columnas de 282 px
// con 24 px de separación en la portada y en los relacionados de la ficha (contenido de 1200 px)— y a las del celular
// (2 columnas de 173 px con 12 px de separación). El catálogo y las categorías usan 3 columnas desde `sm`: el área con
// el panel lateral de 260 px es de 900 px y el prototipo deja ahí un hueco que una grilla fluida aprovecha.
export function GrillaProductos({ columnas, children, ...resto }: { columnas: 3 | 4; children: ReactNode; 'data-testid'?: string; 'aria-hidden'?: boolean }) {
  return (
    <Box
      component="ul"
      {...resto}
      sx={{
        listStyle: 'none', m: 0, p: 0, display: 'grid', gap: { xs: '12px', md: '24px' }, // estilos-sueltos: ok
        justifyContent: { xs: 'start', sm: 'stretch' }, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 173px))', sm: `repeat(${columnas}, minmax(0, 1fr))` },
      }}
    >
      {children}
    </Box>
  )
}
