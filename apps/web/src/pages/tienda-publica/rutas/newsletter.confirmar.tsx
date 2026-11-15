import { Box, Button, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { confirmarNewsletter, type ResultadoConfirmacion } from '../../../lib/tiendaNewsletter'
import { useContextoTienda } from '../layout/LayoutTienda'
import { CabeceraSeo } from '../seo/CabeceraSeo'

const MENSAJES: Record<ResultadoConfirmacion, { titulo: string; detalle: string }> = {
  ok: { titulo: 'Listo, ya estás suscripto', detalle: 'Desde ahora vas a recibir las novedades de la tienda por correo. Vas a poder darte de baja desde cada correo.' },
  vencido: { titulo: 'El enlace venció', detalle: 'Los enlaces de confirmación valen 48 horas. Pedí uno nuevo desde el pie de la tienda.' },
  invalido: { titulo: 'Enlace inválido', detalle: 'No pudimos reconocer este enlace. Revisá que esté completo o pedí uno nuevo desde el pie de la tienda.' },
  espera: { titulo: 'Probá de nuevo en unos minutos', detalle: 'Hiciste varios pedidos seguidos. Abrí el enlace otra vez en unos minutos.' },
  falla: { titulo: 'No pudimos confirmar tu suscripción', detalle: 'Revisá tu conexión y probá de nuevo.' },
}

// `/newsletter/confirmar/:token` (MSF-468, RF-NL-5, CA-NL-5): confirma la suscripción con el token del correo (éxito, vencido o inválido).
// Un enlace ya usado responde «Listo». Ofrece volver al pie para pedir otra confirmación. No se indexa y no guarda el token en ningún lado.
export default function RutaConfirmarNewsletter() {
  const { host } = useContextoTienda()
  const { token = '' } = useParams()
  const [resultado, setResultado] = useState<ResultadoConfirmacion | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    setResultado(null)
    void confirmarNewsletter(host, token).then((valor) => { if (!cancelada) setResultado(valor) })
    return () => { cancelada = true }
  }, [host, token, intento])

  const mensaje = resultado ? MENSAJES[resultado] : null
  return (
    <Box sx={{ py: { xs: 4, md: 8 }, maxWidth: 560, mx: 'auto', textAlign: 'center' }}>
      <CabeceraSeo noindex pagina="Confirmar suscripción" />
      {mensaje ? (
        <Box role="status" data-testid="newsletter-confirmacion" data-resultado={resultado}>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 26, md: 34 } /* estilos-sueltos: ok */ }}>{mensaje.titulo}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 17 /* estilos-sueltos: ok */ }}>{mensaje.detalle}</Typography>
          <Box sx={{ mt: 3, display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            {resultado === 'falla' || resultado === 'espera' ? (
              <Button variant="contained" onClick={() => setIntento((actual) => actual + 1)}>Reintentar</Button>
            ) : null}
            {resultado === 'vencido' || resultado === 'invalido' ? (
              <Button variant="contained" component="a" href="/#newsletter-suscripcion">Volver al pie de la tienda</Button>
            ) : null}
            <Button variant="outlined" component="a" href="/">Ir a la tienda</Button>
          </Box>
        </Box>
      ) : (
        <EstadoCargaPagina />
      )}
    </Box>
  )
}
