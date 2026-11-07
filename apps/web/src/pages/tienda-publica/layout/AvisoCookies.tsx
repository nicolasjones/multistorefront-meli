import { Box, Button, Typography } from '@mui/material'
import { guardarConsentimiento, useConsentimientoCookies } from '../../../lib/consentimientoCookies'

// Aviso de cookies (F-TDA-22, FR-033). Región con nombre accesible, visible mientras no haya decisión. No bloquea
// el uso de la tienda, no roba el foco y se opera con teclado. El texto es mínimo (D7): sin política enlazada
// ni categorías hasta que se confirme qué legal lleva cada marca (D6).
export default function AvisoCookies() {
  const decision = useConsentimientoCookies()
  if (decision !== null) {
    return null
  }
  return (
    <Box
      component="section"
      aria-label="Aviso de cookies"
      data-testid="aviso-cookies"
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (tema) => tema.zIndex.snackbar,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        boxShadow: 3,
        px: 2,
        py: 1.5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
      }}
    >
      <Typography variant="body2" sx={{ flex: '1 1 16rem', minWidth: 0 }}>
        Usamos cookies para mejorar tu experiencia. Podés aceptarlas o rechazarlas.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="outlined" onClick={() => guardarConsentimiento('rechazadas')}>Rechazar</Button>
        <Button variant="contained" onClick={() => guardarConsentimiento('aceptadas')}>Aceptar</Button>
      </Box>
    </Box>
  )
}
