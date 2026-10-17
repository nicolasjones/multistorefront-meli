import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material'
import { Link as RouterLink, useSearchParams } from 'react-router'
import { MarcoAcceso } from '../../components/pagina/MarcoAcceso'
import { passwordDefinitionRedirectUrl, supabaseClient } from '../../lib/supabase'
import { tokens } from '../../tema/tokens'

const neutralNotice = 'Si existe una cuenta para ese correo, enviamos un enlace para continuar.'

const expiredLinkNotice = 'El enlace vencio o ya se uso. Solicita uno nuevo para continuar.'

export function SolicitarRecuperacionPage() {
  const [searchParams] = useSearchParams()
  const linkExpired = searchParams.get('enlace') === 'vencido'
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)

    const { error: requestError } = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: passwordDefinitionRedirectUrl('recuperacion', window.location.origin),
    })

    if (requestError) {
      setError('No pudimos enviar el enlace ahora. Intenta nuevamente mas tarde.')
    } else {
      setNotice(neutralNotice)
    }
    setLoading(false)
  }

  return (
    <MarcoAcceso>
      <Stack spacing={2} component="form" onSubmit={requestRecovery}>
        <Box>
          <Typography component="h1" variant="t1">Recuperar acceso</Typography>
          <Typography variant="bl" color="text.secondary" sx={{ mt: 0.5 }}>Te enviamos un enlace para definir una contraseña nueva.</Typography>
        </Box>
        {linkExpired && <Alert severity="warning">{expiredLinkNotice}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required fullWidth />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar enlace de recuperacion'}
        </Button>
        <Link component={RouterLink} to="/login" sx={{ fontSize: tokens.tipografia.escala.b.tamano, fontWeight: tokens.tipografia.pesoEnfasis }}>
          Volver al ingreso
        </Link>
      </Stack>
    </MarcoAcceso>
  )
}
