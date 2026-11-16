import { Box, Link, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'

// Fila «Cliente» del detalle de un pedido (MSF-176, B1, P-6): «Nº n · nombre». Es un enlace a su ficha (`/clientes/show/:id`) solo si la persona tiene acceso a la sección
// Clientes; si no (o mientras no se sabe), es texto plano. El nombre es texto de la base: se muestra como texto.
export function ClientePedido({ clienteId, numero, nombre }: { clienteId: string; numero: number | null | undefined; nombre: string | null | undefined }) {
  const { nivel } = useNivelSeccion('clientes')
  const texto = `Nº ${numero ?? '—'} · ${nombre ?? 'Cliente'}`
  const conAcceso = nivel === 'lectura' || nivel === 'edicion'
  return (
    <Box>
      <Typography variant="xs">Cliente</Typography>
      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {conAcceso ? <Link component={EnlaceRuta} to={`/clientes/show/${encodeURIComponent(clienteId)}`} underline="hover">{texto}</Link> : texto}
      </Typography>
    </Box>
  )
}
