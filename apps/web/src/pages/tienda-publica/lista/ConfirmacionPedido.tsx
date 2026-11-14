import { Alert, Box, Button, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { formatearImporteArs } from '../../../lib/tiendaCuentaDatos'

// Confirmación del pedido (MSF-176, B1, FR-032, P-5): reemplaza el contenido de `/lista` (no es una ruta aparte). `role="status"`, el foco va al título, la lista ya se vació. Con
// cuenta activa suma «Ir a Mi cuenta». Columna única centrada de hasta 560 px; a 320 px los botones van apilados a ancho completo.
//
// Presupuesto pedido (MSF-176, B2, FR-062): título «Pedimos tu presupuesto Nº {número}», la leyenda de que es un presupuesto y no una compra, el total con IVA, «Ver en Mi cuenta» y «Seguir viendo productos»;
// si el total confirmado difiere del cotizado, un aviso con el total vigente.
export type PresupuestoPedido = { numero: string; totalConIva: number; cambioElPrecio: boolean }

export function ConfirmacionPedido({ conCuenta, presupuesto }: { conCuenta: boolean; presupuesto?: PresupuestoPedido }) {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => { titulo.current?.focus() }, [])
  if (presupuesto) {
    return (
      <Box data-testid="confirmacion-presupuesto" sx={{ maxWidth: 560, mx: 'auto', py: 4 }}>
        <Alert severity="success" role="status" sx={{ '& .MuiAlert-message': { minWidth: 0 } }}>
          <Typography ref={titulo} tabIndex={-1} component="h1" variant="h5" sx={{ outline: 'none', fontWeight: 600, overflowWrap: 'anywhere' }}>{`Pedimos tu presupuesto Nº ${presupuesto.numero}`}</Typography>
          <Typography sx={{ mt: 0.5 }}>Es un presupuesto, no una compra: no reserva stock ni se cobró nada. Te vamos a responder para coordinar.</Typography>
          <Typography sx={{ mt: 1, fontWeight: 600 }}>{`Total con IVA: ${formatearImporteArs(presupuesto.totalConIva)}`}</Typography>
        </Alert>
        {presupuesto.cambioElPrecio ? <Alert severity="info" sx={{ mt: 2 }}>El precio cambió mientras armabas el presupuesto. Este es el total vigente.</Alert> : null}
        <Box sx={{ mt: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <Button component={EnlaceRuta} to="/mi-cuenta?seccion=compras" variant="contained" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Ver en Mi cuenta</Button>
          <Button component={EnlaceRuta} to="/catalogo" variant="outlined" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Seguir viendo productos</Button>
        </Box>
      </Box>
    )
  }
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
