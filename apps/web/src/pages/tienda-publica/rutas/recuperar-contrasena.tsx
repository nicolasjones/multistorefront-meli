import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { AVISO_RECUPERACION, solicitarRecuperacionCliente } from '../../../lib/tiendaCuenta'
import { useContextoTienda } from '../layout/LayoutTienda'

// Recuperación de la contraseña del cliente (F-CLI-06, FR-023): el aviso es el mismo exista o no la cuenta.
export default function RutaRecuperarContrasena() {
  const { host } = useContextoTienda()
  const [correo, setCorreo] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const solicitar = async (event: FormEvent) => {
    event.preventDefault()
    setCargando(true)
    setError(null)
    setAviso(null)
    const enviado = await solicitarRecuperacionCliente(host, correo)
    if (enviado) setAviso(AVISO_RECUPERACION)
    else setError('No pudimos enviar el enlace ahora. Intentá de nuevo más tarde.')
    setCargando(false)
  }

  return (
    <Box sx={{ maxWidth: 420, mx: 'auto', py: 2 }}>
      <Stack spacing={2} component="form" onSubmit={solicitar} aria-labelledby="titulo-recuperar">
        <Typography id="titulo-recuperar" component="h1" variant="h5" sx={{ fontWeight: 700 }}>Recuperar contraseña</Typography>
        <Typography color="text.secondary">Te enviamos un enlace para definir una contraseña nueva.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {aviso && <Alert severity="success">{aviso}</Alert>}
        <TextField label="Correo" type="email" value={correo} onChange={(event) => setCorreo(event.target.value)} autoComplete="email" required fullWidth />
        <Button type="submit" variant="contained" size="large" disabled={cargando}>
          {cargando ? 'Enviando...' : 'Enviar enlace'}
        </Button>
        <Link component={EnlaceRuta} to="/ingresar">Volver a ingresar</Link>
      </Stack>
    </Box>
  )
}
