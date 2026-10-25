import { Box, Button, Typography } from '@mui/material'

// Sin resultados (F-TDA-12, FR-038): mensaje, sugerencia y salida clara.
export function EstadoVacioCatalogo({ alLimpiar }: { alLimpiar: () => void }) {
  return (
    <Box data-testid="catalogo-vacio" role="status" sx={{ py: 6, textAlign: 'center' }}>
      <Typography component="h2" variant="h6" gutterBottom>No encontramos productos</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>Probá con otra categoría o quitá el filtro de stock.</Typography>
      <Button variant="outlined" onClick={alLimpiar}>Limpiar filtros</Button>
    </Box>
  )
}
