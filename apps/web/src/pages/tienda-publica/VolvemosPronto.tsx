import { Box, Typography } from '@mui/material'

// Versión mínima de «Volvemos pronto» (FR-003, F-TDA-19 completa queda fuera). Se muestra igual
// para un dominio sin configurar y para una tienda desactivada: no revela si el dominio existe.
export function VolvemosPronto() {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}
    >
      <Typography component="h1" variant="h4" sx={{ mb: 1 }}>Volvemos pronto</Typography>
      <Typography color="text.secondary">Estamos preparando esta tienda. Volvé a visitarnos en un rato.</Typography>
    </Box>
  )
}
