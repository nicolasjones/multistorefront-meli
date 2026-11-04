import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material'
import { Link as RouterLink, Navigate, useNavigate } from 'react-router'
import { passwordPolicyDescription, validatePassword } from '../../lib/passwordPolicy'
import { closeOtherSessions, supabaseClient, verifyCurrentPassword } from '../../lib/supabase'

type SessionState = 'checking' | 'ready' | 'missing'

function isIncorrectCurrentPassword(error: { code?: string; message?: string }) {
  return error.code === 'invalid_credentials' || /current password|contrase(ñ|n)a actual|incorrect/i.test(error.message ?? '')
}

export function CambiarContrasenaPage() {
  const navigate = useNavigate()
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    void supabaseClient.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      const sessionEmail = data.session?.user.email
      setEmail(sessionEmail ?? null)
      setSessionState(!sessionError && sessionEmail ? 'ready' : 'missing')
    })
    return () => {
      active = false
    }
  }, [])

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    const validation = validatePassword(password, confirmation)
    if (!validation.valid) {
      setError(validation.message)
      return
    }

    setLoading(true)
    setError(null)
    const { error: verificationError } = await verifyCurrentPassword(email!, currentPassword)
    if (verificationError) {
      setError(
        isIncorrectCurrentPassword(verificationError)
          ? 'La contraseña actual no coincide. Podés recuperar el acceso si no la recordás.'
          : 'No pudimos verificar la contraseña actual. Intentá nuevamente.',
      )
      setLoading(false)
      return
    }

    const { error: updateError } = await supabaseClient.auth.updateUser({
      current_password: currentPassword,
      password,
    })

    if (updateError) {
      setError(
        isIncorrectCurrentPassword(updateError)
          ? 'La contraseña actual no coincide. Podés recuperar el acceso si no la recordás.'
          : 'No pudimos modificar la contraseña. La anterior sigue vigente; intentá nuevamente.',
      )
      setLoading(false)
      return
    }

    const { error: signOutError } = await closeOtherSessions()
    if (signOutError) {
      setError('La contraseña se actualizó, pero no pudimos cerrar otras sesiones. Intentá cambiarla nuevamente.')
      setLoading(false)
      return
    }

    navigate('/', { replace: true })
  }

  if (sessionState === 'checking') {
    return <CircularProgress aria-label="Verificando sesión" sx={{ m: 4 }} />
  }

  if (sessionState === 'missing') {
    return <Navigate to="/login" replace />
  }

  return (
    <Box component="main" sx={{ maxWidth: 480, mx: 'auto', mt: 4, px: 2 }}>
      <Stack spacing={2} component="form" onSubmit={changePassword}>
        <Typography component="h1" variant="t1">Cambiar contraseña</Typography>
        <Typography color="text.secondary">{passwordPolicyDescription}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Contraseña actual" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required fullWidth />
        <TextField label="Nueva contraseña" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required fullWidth />
        <TextField label="Confirmar contraseña" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required fullWidth />
        <Button type="submit" variant="contained" disabled={loading}>
          {loading ? 'Cambiando...' : 'Cambiar contraseña'}
        </Button>
        {error && isIncorrectCurrentPassword({ message: error }) && (
          <Link component={RouterLink} to="/acceso/solicitar-recuperacion">Recuperar acceso</Link>
        )}
      </Stack>
    </Box>
  )
}
