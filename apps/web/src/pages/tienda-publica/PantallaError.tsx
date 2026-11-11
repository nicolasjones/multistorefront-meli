import { Box, Button, Typography } from '@mui/material'
import { CabeceraSeo } from './seo/CabeceraSeo'

type Props = {
  alReintentar: () => void
  alVolverAlInicio?: () => void
  // Dentro del layout de la tienda (que ya tiene su `main`) no se repite el landmark.
  dentroDeTienda?: boolean
}

// Pantalla completa de error (F-TDA-19, FR-004): falla al resolver la tienda o al cargar una página.
// Anunciada con `role="alert"`, sin detalle técnico. «Volver al inicio» recarga la raíz del sitio (la
// pantalla puede mostrarse fuera del enrutador, p. ej. cuando falla la resolución de la tienda).
export function PantallaError({ alReintentar, alVolverAlInicio = () => window.location.assign('/'), dentroDeTienda = false }: Props) {
  return (
    <Box
      component={dentroDeTienda ? 'div' : 'main'}
      data-testid="pantalla-error"
      sx={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2, py: 6 }}
    >
      <CabeceraSeo noindex pagina="No pudimos cargar esta página" />
      <Box role="alert" sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4" gutterBottom>No pudimos cargar esta página.</Typography>
        <Typography color="text.secondary">Revisá tu conexión y probá de nuevo.</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
        <Button variant="contained" onClick={alReintentar} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Reintentar</Button>
        <Button variant="outlined" onClick={alVolverAlInicio} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Volver al inicio</Button>
      </Box>
    </Box>
  )
}
