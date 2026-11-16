import { Box, Button, Typography } from '@mui/material'
import { useState } from 'react'
import { useParams } from 'react-router'
import { darDeBajaNewsletter, type ResultadoBaja } from '../../../lib/tiendaNewsletter'
import { CabeceraSeo } from '../seo/CabeceraSeo'

type Estado = ResultadoBaja | 'confirmar' | 'procesando'

// `/newsletter/baja/:token` (MSF-468, RF-NL-7, CA-NL-6): un botón confirma la baja (un visor de enlaces no debe dar de baja a nadie solo por
// abrirlo). La respuesta es siempre genérica: no revela si el enlace era válido ni a quién pertenece. No se indexa y no guarda el token.
export default function RutaBajaNewsletter() {
  const { token = '' } = useParams()
  const [estado, setEstado] = useState<Estado>('confirmar')

  const darDeBaja = async () => {
    setEstado('procesando')
    setEstado(await darDeBajaNewsletter(token))
  }

  return (
    <Box sx={{ py: { xs: 4, md: 8 }, maxWidth: 560, mx: 'auto', textAlign: 'center' }}>
      <CabeceraSeo noindex pagina="Darte de baja del newsletter" />
      {estado === 'hecha' ? (
        <Box role="status" data-testid="newsletter-baja" data-resultado="hecha">
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 26, md: 34 } /* estilos-sueltos: ok */ }}>Listo, no vas a recibir más correos</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 17 /* estilos-sueltos: ok */ }}>Si hay algún envío en curso, tampoco te va a llegar. Podés volver a suscribirte cuando quieras desde el pie de la tienda.</Typography>
          <Button sx={{ mt: 3 }} variant="outlined" component="a" href="/">Ir a la tienda</Button>
        </Box>
      ) : estado === 'invalida' ? (
        <Box role="status" data-testid="newsletter-baja" data-resultado="invalida">
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 26, md: 34 } /* estilos-sueltos: ok */ }}>Enlace inválido</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 17 /* estilos-sueltos: ok */ }}>No pudimos reconocer este enlace. Usá el enlace del último correo que recibiste.</Typography>
          <Button sx={{ mt: 3 }} variant="outlined" component="a" href="/">Ir a la tienda</Button>
        </Box>
      ) : (
        <Box>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 26, md: 34 } /* estilos-sueltos: ok */ }}>Darte de baja del newsletter</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 17 /* estilos-sueltos: ok */ }}>Confirmá que no querés recibir más novedades de esta tienda por correo. Podés volver a suscribirte cuando quieras.</Typography>
          {estado === 'falla' ? (
            <Typography role="alert" color="error" sx={{ mt: 2 }}>No pudimos procesar la baja. Probá de nuevo en un rato.</Typography>
          ) : null}
          <Button sx={{ mt: 3 }} variant="contained" size="large" onClick={() => void darDeBaja()} disabled={estado === 'procesando'}>
            {estado === 'procesando' ? 'Procesando…' : 'Darme de baja'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
