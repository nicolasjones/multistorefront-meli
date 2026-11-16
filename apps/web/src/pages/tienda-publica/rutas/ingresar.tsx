import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material'
import { Link as EnlaceRuta, useNavigate, useSearchParams } from 'react-router'
import { ingresarCliente } from '../../../lib/tiendaCuenta'
import { rutaVolverSegura } from '../../../lib/tiendaVolver'
import { useContextoTienda } from '../layout/LayoutTienda'
import { CabeceraSeo } from '../seo/CabeceraSeo'

// Ingreso del cliente a la tienda (F-CLI-06, FR-020/FR-021): correo y contraseña. Solo entra una cuenta web
// activa y habilitada en esta tienda; cualquier otro caso muestra el mismo mensaje genérico. F-CLI-20 (FR-002): con
// `?volver=<ruta>` vuelve a esa pantalla tras ingresar, pero SOLO si es una ruta interna (`rutaVolverSegura`: nada de
// `//`, `:` ni `\`, para que el enlace no sirva de redirección abierta); si no, a la portada como siempre.
export default function RutaIngresar() {
  const { host } = useContextoTienda()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const volver = rutaVolverSegura(params.get('volver'))
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const ingresar = async (event: FormEvent) => {
    event.preventDefault()
    setCargando(true)
    setError(null)
    const resultado = await ingresarCliente(host, correo, contrasena)
    if (resultado.ok) {
      navigate(volver ?? '/', { replace: true })
      return
    }
    setError(resultado.mensaje)
    setContrasena('')
    setCargando(false)
  }

  return (
    <Box sx={{ maxWidth: 420, mx: 'auto', py: 2 }}>
      <CabeceraSeo noindex pagina="Ingresar" />
      <Stack spacing={2} component="form" onSubmit={ingresar} aria-labelledby="titulo-ingresar">
        <Typography id="titulo-ingresar" component="h1" variant="h5" sx={{ fontWeight: 700 }}>Ingresar</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Correo" type="email" value={correo} onChange={(event) => setCorreo(event.target.value)} autoComplete="email" required fullWidth />
        <TextField label="Contraseña" type="password" value={contrasena} onChange={(event) => setContrasena(event.target.value)} autoComplete="current-password" required fullWidth />
        <Button type="submit" variant="contained" size="large" disabled={cargando}>
          {cargando ? 'Ingresando...' : 'Ingresar'}
        </Button>
        <Link component={EnlaceRuta} to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
      </Stack>
    </Box>
  )
}
