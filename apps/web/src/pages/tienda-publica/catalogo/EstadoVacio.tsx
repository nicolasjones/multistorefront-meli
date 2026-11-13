import { Box, Button, Typography } from '@mui/material'

// Sin resultados (F-TDA-12, FR-038; prototipo «No hay productos con esos filtros»): recuadro de borde punteado con el mensaje,
// la sugerencia y la salida clara «Limpiar filtros» (botón primario).
export function EstadoVacioCatalogo({ alLimpiar }: { alLimpiar: () => void }) {
  return (
    <Box data-testid="catalogo-vacio" role="status" sx={{ py: { xs: '40px', md: '60px' }, px: { xs: '16px', md: '20px' }, textAlign: 'center', border: '1.5px dashed rgba(0,0,0,.15)', borderRadius: '12px' /* estilos-sueltos: ok */ }}>
      <Typography component="h2" variant="h6" sx={{ fontSize: { xs: 20, md: 22 } /* estilos-sueltos: ok */ }}>No hay productos con esos filtros</Typography>
      <Typography color="text.secondary" sx={{ mt: '6px', display: { xs: 'none', md: 'block' } }}>Probá con otra categoría o quitá el filtro de stock.</Typography>
      <Button variant="contained" onClick={alLimpiar} sx={{ mt: { xs: '14px', md: '16px' }, px: '20px', py: '12px', fontSize: 16 /* estilos-sueltos: ok */ }}>Limpiar filtros</Button>
    </Box>
  )
}
