import { Alert, Box, Stack, Typography } from '@mui/material'
import { textoFecha, textoDestinatarios, type VistaPreviaNewsletterDatos } from '../../../lib/newsletter'

type Props = { datos: VistaPreviaNewsletterDatos | null; cargando: boolean; hayError: boolean }

// Vista previa del newsletter (RF-NL-15, CA-NL-9): el HTML lo arma la base con la MISMA función que usa el envío (mensaje y nombres
// escapados, secciones, pie fijo con un enlace de baja de ejemplo), así que lo que se ve es lo que se recibe. Se muestra en un iframe
// sin permisos (`sandbox=""`): no ejecuta scripts ni navega.
export function VistaPreviaNewsletter({ datos, cargando, hayError }: Props) {
  if (hayError) return <Alert severity="error" role="alert">No pudimos armar la vista previa. Probá de nuevo.</Alert>
  if (cargando && !datos) return <Typography variant="s" color="text.secondary" role="status">Armando la vista previa…</Typography>
  if (!datos) return <Typography variant="s" color="text.secondary">Tocá «Vista previa» para ver cómo queda el correo.</Typography>
  return (
    <Stack spacing={1} data-testid="vista-previa-newsletter">
      <Typography variant="xs" color="text.secondary">
        Precios al día {textoFecha(datos.generado_en)}. Llegaría a {textoDestinatarios(datos.confirmados)} confirmados. El enlace de baja es de ejemplo.
      </Typography>
      <Box
        component="iframe"
        title="Vista previa del correo"
        sandbox=""
        srcDoc={datos.html}
        sx={{ width: '100%', minHeight: 320 /* estilos-sueltos: ok */, border: 1, borderColor: 'divider', bgcolor: 'common.white' }}
      />
    </Stack>
  )
}
