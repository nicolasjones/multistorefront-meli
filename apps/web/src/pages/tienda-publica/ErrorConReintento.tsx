import { Alert, Box, Button, Typography } from '@mui/material'

type Props = {
  alReintentar: () => void
  titulo?: string
  descripcion?: string
}

// Error de red de las pantallas públicas (F-TDA-17, FR-045, D8): mensaje anunciado a lector de pantalla
// y «Reintentar», que repite el pedido sin tocar la URL ni los filtros (quien lo usa solo vuelve a
// pedir). El botón ocupa el ancho del celular para ser cómodo al tacto.
export function ErrorConReintento({
  alReintentar,
  titulo = 'No pudimos cargar esta página.',
  descripcion = 'Revisá tu conexión y probá de nuevo.',
}: Props) {
  return (
    <Alert
      severity="error"
      data-testid="error-con-reintento"
      sx={{ alignItems: 'center', flexWrap: 'wrap', '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}
      action={<Button color="inherit" onClick={alReintentar} sx={{ minHeight: 44 }}>Reintentar</Button>}
    >
      <Typography component="p" fontWeight={600}>{titulo}</Typography>
      <Box component="span">{descripcion}</Box>
    </Alert>
  )
}
