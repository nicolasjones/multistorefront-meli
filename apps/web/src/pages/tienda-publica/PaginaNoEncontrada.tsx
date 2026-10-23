import { Box, Button, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'

// 404 amable reutilizable (F-TDA-11, FR-007): categoría inexistente, oculta o de otra empresa, ruta
// desconocida y (F-TDA-13) producto no disponible. El mensaje es el mismo en todos los casos: no
// revela si el recurso existe.
export function PaginaNoEncontrada() {
  return (
    <Box data-testid="pagina-no-encontrada" sx={{ py: 6, textAlign: 'center' }}>
      <Typography component="h1" variant="h4" gutterBottom>No encontramos esta página</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Puede que el enlace esté desactualizado o que ya no esté disponible.
      </Typography>
      <Button component={EnlaceRuta} to="/" variant="contained">Volver al inicio</Button>
    </Box>
  )
}
