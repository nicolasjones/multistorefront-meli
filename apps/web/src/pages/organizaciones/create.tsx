import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Create } from '@refinedev/mui'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'

// No es un create de Refine contra la tabla organizaciones directamente:
// no hay policy de INSERT para authenticated (FR-010, solo la Edge
// Function puede crear una organización). Contrato:
// specs/003-fundacion-multitenant/contracts/crear-organizacion.md
export function OrganizacionCreate() {
  const navigate = useNavigate()
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()

  const [nombre, setNombre] = useState('')
  const [emailFundador, setEmailFundador] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (checkingSuperadmin) {
    return null
  }

  if (!isSuperadmin) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Esta pantalla es solo para el superadmin de la plataforma.
      </Alert>
    )
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const { error: invokeError } = await supabaseClient.functions.invoke('crear-organizacion', {
      body: { nombre, email_fundador: emailFundador },
    })

    if (invokeError) {
      let message = invokeError.message
      if (invokeError instanceof FunctionsHttpError) {
        const body = await invokeError.context.json().catch(() => null)
        message = body?.error ?? message
      }
      setError(message)
      setLoading(false)
      return
    }

    navigate('/organizaciones')
  }

  return (
    <Create title="Crear organización" isLoading={loading} saveButtonProps={{ style: { display: 'none' } }}>
      <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 480 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            El email del fundador recibe una invitación por correo y queda como
            administrador de la organización (no hay alta de cuenta propia).
          </Typography>
          <TextField
            label="Nombre de la organización"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Email del fundador"
            type="email"
            value={emailFundador}
            onChange={(event) => setEmailFundador(event.target.value)}
            required
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Creando…' : 'Crear e invitar'}
          </Button>
        </Stack>
      </Box>
    </Create>
  )
}
