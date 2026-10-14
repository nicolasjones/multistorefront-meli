import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { Navigate, useNavigate } from 'react-router'
import { closeOtherSessions, supabaseClient, type PasswordFlowOrigin } from '../../lib/supabase'
import { passwordPolicyDescription, passwordRules, validatePassword } from '../../lib/passwordPolicy'
import { nombreDeRol } from '../../lib/rolesUsuarios'

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

type LinkState = 'checking' | 'ready' | 'invalid'
type InvitacionVigente = { rol_id: string; vencida: boolean }

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
  const [invitacion, setInvitacion] = useState<InvitacionVigente | null>(null)

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

  useEffect(() => {
    if (source !== 'invitacion' || linkState !== 'ready') return

    let active = true
    // «Fuiste invitado como <rol>»: si falla la consulta se muestra el formulario sin el rol.
    void Promise.resolve(supabaseClient.rpc('mi_invitacion')).then(({ data }) => {
      const fila = Array.isArray(data) ? data[0] : null
      if (active && fila) setInvitacion({ rol_id: fila.rol_id, vencida: Boolean(fila.vencida) })
    }).catch((consultaError: unknown) => {
      console.error('definir-contrasena: no se pudo consultar la invitación', consultaError)
    })
    return () => { active = false }
  }, [source, linkState])

  const definePassword = async (event: FormEvent) => {
    event.preventDefault()
    const validation = validatePassword(password, confirmation)
    if (!validation.valid) {
      setError(validation.message)
      return
    }

    setLoading(true)
    setError(null)
    // Crea la membresía con el rol invitado; rechaza invitaciones vencidas o canceladas. Es idempotente:
    // si el guardado de la contraseña falla, el reintento vuelve a pasar por aquí sin error. También se
    // intenta con el enlace de recuperación («Solicitar otro enlace» cuando venció el de la invitación):
    // ahí no tener invitación (P0002), que esté vencida (P0001) o ya ser miembro (23505) es lo normal
    // de una recuperación común y no bloquea el cambio de contraseña.
    const { error: acceptError } = await supabaseClient.rpc('aceptar_invitacion')
    const sinInvitacionEnRecuperacion = source === 'recuperacion'
      && (acceptError?.code === 'P0001' || acceptError?.code === 'P0002' || acceptError?.code === '23505')
    if (acceptError && !sinInvitacionEnRecuperacion) {
      setError(acceptError.code === 'P0001'
        ? 'La invitación venció. Pídele a un Administrador que te envíe una nueva.'
        : acceptError.code === 'P0002'
          ? 'La invitación fue cancelada o ya no existe. Pídele a un Administrador que te invite de nuevo.'
          : 'No pudimos aceptar la invitación. Intenta nuevamente.')
      setLoading(false)
      return
    }
    const { error: updateError } = await supabaseClient.auth.updateUser({ password })
    if (updateError) {
      setError(source === 'invitacion'
        ? 'Tu invitación ya quedó aceptada, pero no pudimos guardar la contraseña. Intenta nuevamente.'
        : 'No pudimos actualizar la contraseña. La anterior sigue vigente; intenta nuevamente.')
      setLoading(false)
      return
    }

    const { error: signOutError } = await closeOtherSessions()
    if (signOutError) {
      setError('La contraseña se actualizó, pero no pudimos cerrar otras sesiones. Intenta recuperarla nuevamente.')
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

  const missingRules = passwordRules.filter((rule) => !rule.test(password))
  const heading = source === 'invitacion' ? 'Crea tu contraseña' : 'Define una contraseña nueva'

  return (
    <Box component="main" sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
      <Stack spacing={2} component="form" onSubmit={definePassword}>
        <Typography component="h1" variant="h4">{heading}</Typography>
        {source === 'invitacion' && invitacion && !invitacion.vencida && (
          <Typography>Fuiste invitado como <strong>{nombreDeRol(invitacion.rol_id)}</strong>.</Typography>
        )}
        {source === 'invitacion' && invitacion?.vencida && (
          <Alert severity="warning">La invitación venció. Pídele a un Administrador que te envíe una nueva.</Alert>
        )}
        <Typography color="text.secondary">{passwordPolicyDescription}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Nueva contraseña"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          slotProps={{ htmlInput: { 'aria-describedby': 'reglas-contrasena' } }}
        />
        <List id="reglas-contrasena" dense disablePadding aria-label="Reglas de la contrasena">
          {passwordRules.map((rule) => {
            const met = rule.test(password)
            return (
              <ListItem key={rule.id} disableGutters>
                <ListItemText
                  primary={`${met ? 'Cumple' : 'Falta'}: ${rule.label}`}
                  primaryTypographyProps={{ color: met ? 'success.main' : 'text.secondary', variant: 'body2' }}
                />
              </ListItem>
            )
          })}
        </List>
        <Typography role="status" aria-live="polite" sx={visuallyHidden}>
          {missingRules.length === 0
            ? 'La contrasena cumple todas las reglas.'
            : `Faltan ${missingRules.length} de ${passwordRules.length} reglas.`}
        </Typography>
        <TextField
          label="Confirmar contraseña"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={loading || Boolean(invitacion?.vencida)}>
          {loading ? 'Guardando...' : source === 'invitacion' ? 'Guardar y entrar' : 'Guardar contraseña'}
        </Button>
      </Stack>
    </Box>
  )
}
