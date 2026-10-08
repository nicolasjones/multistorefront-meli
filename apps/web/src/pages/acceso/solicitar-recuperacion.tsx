import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { passwordDefinitionRedirectUrl, supabaseClient } from '../../lib/supabase'

const neutralNotice = 'Si existe una cuenta para ese correo, enviamos un enlace para continuar.'

export function SolicitarRecuperacionPage() {
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
    <Box component="main" sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
      <Stack spacing={2} component="form" onSubmit={requestRecovery}>
        <Typography component="h1" variant="h4">Recuperar acceso</Typography>
        <Typography color="text.secondary">Te enviaremos un enlace para definir una contrasena nueva.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required fullWidth />
        <Button type="submit" variant="contained" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar enlace de recuperacion'}
        </Button>
      </Stack>
    </Box>
  )
}
