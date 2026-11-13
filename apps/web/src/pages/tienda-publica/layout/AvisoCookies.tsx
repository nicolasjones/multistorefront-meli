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
        // ESTRICTAMENTE debajo de los paneles laterales (menú y filtros del celular son `Drawer` temporales de MUI, con
        // `zIndex.drawer`): en el celular el aviso fijo tapaba sus botones de abajo («Ver N productos») y no se podían tocar.
        // Con un panel abierto el resto de la página (aviso incluido) queda inerte. No depende del orden del DOM.
        zIndex: (tema) => tema.zIndex.drawer - 1,
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
        Usamos cookies para mejorar tu experiencia y, si la tienda lo configuró, medir las visitas con Google Analytics y
        Meta. No enviamos tus datos personales (nombre, email, teléfono ni lo que escribís). Podés aceptarlas o rechazarlas.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="outlined" onClick={() => guardarConsentimiento('rechazadas')}>Rechazar</Button>
        <Button variant="contained" onClick={() => guardarConsentimiento('aceptadas')}>Aceptar</Button>
      </Box>
    </Box>
  )
}
