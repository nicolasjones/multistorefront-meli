import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { Navigate, useNavigate } from 'react-router'
import { closeOtherSessions, supabaseClient, type PasswordFlowOrigin } from '../../lib/supabase'
import { passwordPolicyDescription, passwordRules, validatePassword } from '../../lib/passwordPolicy'

type LinkState = 'checking' | 'ready' | 'invalid'

function accessLinkOrigin(): PasswordFlowOrigin | null {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const type = hash.get('type')

  if (!hash.get('access_token')) return null
  if (type === 'invite') return 'invitacion'
  if (type === 'recovery') return 'recuperacion'
  return null
}

export function DefinirContrasenaPage() {
  const navigate = useNavigate()
  const source = useMemo(() => accessLinkOrigin(), [])
  const [linkState, setLinkState] = useState<LinkState>(source ? 'checking' : 'invalid')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!source) return

    let active = true
    const setSessionState = (session: unknown) => {
      if (active) setLinkState(session ? 'ready' : 'invalid')
    }

    void supabaseClient.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        setSessionState(null)
        return
      }
      setSessionState(data.session)
    })

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => setSessionState(session))

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [source])

  const definePassword = async (event: FormEvent) => {
    event.preventDefault()
    const validation = validatePassword(password, confirmation)
    if (!validation.valid) {
      setError(validation.message)
      return
    }

    setLoading(true)
    setError(null)
    const { error: updateError } = await supabaseClient.auth.updateUser({ password })
    if (updateError) {
      setError('No pudimos actualizar la contrasena. La anterior sigue vigente; intenta nuevamente.')
      setLoading(false)
      return
    }

    const { error: signOutError } = await closeOtherSessions()
    if (signOutError) {
      setError('La contrasena se actualizo, pero no pudimos cerrar otras sesiones. Intenta recuperarla nuevamente.')
      setLoading(false)
      return
    }

    navigate('/', { replace: true })
  }

  if (linkState === 'checking') {
    return <CircularProgress aria-label="Validando enlace" sx={{ m: 4 }} />
  }

  if (linkState === 'invalid') {
    return <Navigate to="/acceso/solicitar-recuperacion?enlace=vencido" replace />
  }

  const heading = source === 'invitacion' ? 'Crea tu contrasena' : 'Define una contrasena nueva'

  return (
    <Box component="main" sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
      <Stack spacing={2} component="form" onSubmit={definePassword}>
        <Typography component="h1" variant="h4">{heading}</Typography>
        <Typography color="text.secondary">{passwordPolicyDescription}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Nueva contrasena"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
        />
        <List dense disablePadding aria-label="Reglas de la contrasena">
          {passwordRules.map((rule) => {
            const met = rule.test(password)
            return (
              <ListItem key={rule.id} disableGutters data-met={met}>
                <ListItemText
                  primary={`${met ? 'Cumple' : 'Falta'}: ${rule.label}`}
                  primaryTypographyProps={{ color: met ? 'success.main' : 'text.secondary', variant: 'body2' }}
                />
              </ListItem>
            )
          })}
        </List>
        <TextField
          label="Confirmar contrasena"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar contrasena'}
        </Button>
      </Stack>
    </Box>
  )
}
