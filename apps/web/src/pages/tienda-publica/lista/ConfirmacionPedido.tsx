import { Alert, Box, Button, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { Link as EnlaceRuta } from 'react-router'

// Confirmación del pedido (MSF-176, B1, FR-032, P-5): reemplaza el contenido de `/lista` (no es una ruta aparte). `role="status"`, el foco va al título, la lista ya se vació. Con
// cuenta activa suma «Ir a Mi cuenta». Columna única centrada de hasta 560 px; a 320 px los botones van apilados a ancho completo.
export function ConfirmacionPedido({ conCuenta }: { conCuenta: boolean }) {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => { titulo.current?.focus() }, [])
  return (
    <Box data-testid="confirmacion-pedido" sx={{ maxWidth: 560, mx: 'auto', py: 4 }}>
      <Alert severity="success" role="status" sx={{ '& .MuiAlert-message': { minWidth: 0 } }}>
        <Typography ref={titulo} tabIndex={-1} component="h1" variant="h5" sx={{ outline: 'none', fontWeight: 600 }}>Recibimos tu pedido</Typography>
        <Typography sx={{ mt: 0.5 }}>Te vamos a responder para confirmar disponibilidad y precio. No se cobró nada.</Typography>
      </Alert>
      <Box sx={{ mt: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
        <Button component={EnlaceRuta} to="/catalogo" variant="contained" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Seguir viendo productos</Button>
        {conCuenta ? <Button component={EnlaceRuta} to="/mi-cuenta" variant="outlined" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Ir a Mi cuenta</Button> : null}
      </Box>
    </Box>
  )
}
