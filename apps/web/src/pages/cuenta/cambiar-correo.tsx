import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { Navigate } from 'react-router'
import { profileRedirectUrl, supabaseClient, verifyCurrentPassword } from '../../lib/supabase'

type SessionState = 'checking' | 'ready' | 'missing'

function esContrasenaActualIncorrecta(error: { code?: string; message?: string }) {
  return error.code === 'invalid_credentials' || /current password|contrasena actual|incorrect/i.test(error.message ?? '')
}

function esCorreoNoDisponible(error: { code?: string; message?: string }) {
  return error.code === 'email_exists' || /already registered|already been registered|email.*exist/i.test(error.message ?? '')
}

function esCorreoValido(correo: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
}

// Movida de perfil.tsx a su propia pantalla, mismo patrón que
// cambiar-contrasena.tsx — sin cambios de reglas de negocio (mismas
// validaciones, mismo flujo de confirmación por correo).
export function CambiarCorreoPage() {
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [correoActual, setCorreoActual] = useState<string | null>(null)
  const [contrasenaActual, setContrasenaActual] = useState('')
  const [correoNuevo, setCorreoNuevo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [solicitandoCorreo, setSolicitandoCorreo] = useState(false)

  useEffect(() => {
    let activa = true
    void supabaseClient.auth.getSession().then(({ data, error: sessionError }) => {
      if (!activa) return
      const sessionEmail = data.session?.user.email
      setCorreoActual(sessionEmail ?? null)
      setSessionState(!sessionError && sessionEmail ? 'ready' : 'missing')
    })
    return () => { activa = false }
  }, [])

  const solicitarCambioCorreo = async (event: FormEvent) => {
    event.preventDefault()
    const correoLimpio = correoNuevo.trim().toLowerCase()
    setError(null)
    setMensaje(null)
    if (!correoActual || !contrasenaActual) {
      setError('Ingresa tu contrasena actual para solicitar el cambio de correo.')
      return
    }
    if (!esCorreoValido(correoLimpio)) {
      setError('Ingresa un correo electronico valido.')
      return
    }
    if (correoLimpio === correoActual.toLowerCase()) {
      setError('El correo nuevo debe ser distinto del actual.')
      return
    }

    setSolicitandoCorreo(true)
    const { error: errorVerificacion } = await verifyCurrentPassword(correoActual, contrasenaActual)
    if (errorVerificacion) {
      setError(
        esContrasenaActualIncorrecta(errorVerificacion)
          ? 'La contrasena actual no coincide.'
          : 'No pudimos verificar la contrasena actual. Intenta nuevamente.',
      )
      setSolicitandoCorreo(false)
      return
    }

    const { error: errorActualizacion } = await supabaseClient.auth.updateUser(
      { email: correoLimpio },
      { emailRedirectTo: profileRedirectUrl(window.location.origin) },
    )
    if (errorActualizacion) {
      setError(
        esCorreoNoDisponible(errorActualizacion)
          ? 'No se puede usar ese correo electronico. Elige otro e intenta nuevamente.'
          : 'No pudimos solicitar el cambio de correo. Intenta nuevamente.',
      )
      setSolicitandoCorreo(false)
      return
    }

    setContrasenaActual('')
    setCorreoNuevo('')
    setMensaje(`Enviamos una confirmacion a ${correoLimpio}. Tu correo actual seguira vigente hasta confirmarla.`)
    setSolicitandoCorreo(false)
  }

  if (sessionState === 'checking') {
    return <CircularProgress aria-label="Verificando sesion" sx={{ m: 4 }} />
  }

  if (sessionState === 'missing') {
    return <Navigate to="/login" replace />
  }

  return (
    <Box component="main" sx={{ maxWidth: 480, mx: 'auto', mt: 4, px: 2 }}>
      <Stack component="form" spacing={2} onSubmit={solicitarCambioCorreo} noValidate>
        <Typography component="h1" variant="h4">Cambiar correo electronico</Typography>
        <Typography color="text.secondary">Confirmaremos el cambio solo en la nueva direccion. Tu correo actual seguira vigente hasta entonces.</Typography>
        {error && <Alert severity="error" role="alert">{error}</Alert>}
        {mensaje && <Alert severity="success" role="status">{mensaje}</Alert>}
        <TextField
          label="Contrasena actual para cambiar el correo"
          type="password"
          value={contrasenaActual}
          onChange={(event) => setContrasenaActual(event.target.value)}
          autoComplete="current-password"
          required
          fullWidth
        />
        <TextField
          label="Correo electronico nuevo"
          type="email"
          value={correoNuevo}
          onChange={(event) => setCorreoNuevo(event.target.value)}
          autoComplete="email"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={solicitandoCorreo} aria-busy={solicitandoCorreo}>
          {solicitandoCorreo ? 'Solicitando...' : 'Solicitar cambio de correo'}
        </Button>
      </Stack>
    </Box>
  )
}
