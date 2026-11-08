import { Box, Typography } from '@mui/material'

// Bloque «Cómo se calcula» de la pantalla de precios de la empresa (F-PRE-09, FR-025; StorePrecios.dc.html): los
// cuatro pasos del precio que ve el cliente. El paso 3 es el del precio propio: reemplaza al calculado.
export function ComoSeCalcula({ nombreEmpresa }: { nombreEmpresa: string }) {
  const pasos = [
    'Precio central del producto (en USD se multiplica por el dólar del día).',
    `Ajuste de ${nombreEmpresa}, si lo tiene.`,
    'Precio propio del producto en esta empresa, si existe: reemplaza al calculado.',
    'Mercado Libre parte de este precio y suma su recargo (pestaña Mercado Libre).',
  ]
  return (
    <Box component="section" aria-labelledby="como-se-calcula-titulo" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2.5 }}>
      <Typography id="como-se-calcula-titulo" component="h2" variant="h6" sx={{ mb: 1 }}>Cómo se calcula</Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 1 }}>
        {pasos.map((paso) => (
          <Typography key={paso} component="li" variant="body2">{paso}</Typography>
        ))}
      </Box>
    </Box>
  )
}
