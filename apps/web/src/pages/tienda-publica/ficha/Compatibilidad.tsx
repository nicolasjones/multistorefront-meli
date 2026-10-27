import { Box, Typography } from '@mui/material'

// Compatibilidad opcional (F-TDA-13, FR-055): el texto ya llega unido por coma desde la base. Sin datos,
// el bloque no se renderiza.
export function Compatibilidad({ compatibilidad }: { compatibilidad: string | null }) {
  if (!compatibilidad) return null
  return (
    <Box data-testid="compatibilidad" sx={{ mt: 2 }}>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>Compatible con</Typography>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{compatibilidad}</Typography>
    </Box>
  )
}
