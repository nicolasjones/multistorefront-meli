import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreate } from '@refinedev/core'
import { Alert, Box, Button, Stack, TextField } from '@mui/material'
import { Create } from '@refinedev/mui'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'

// Solo alcanzable desde la UI si administrador (US3) — RLS rechaza igual
// si un miembro llega acá por otra vía (clientes_insert exige
// private.puede_escribir()).
export function ClienteCreate() {
  const navigate = useNavigate()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { mutate, mutation } = useCreate()
  const isPending = mutation.isPending
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (checkingPermiso) {
    return null
  }

  if (!puedeEscribir) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Solo un administrador puede crear clientes.
      </Alert>
    )
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    mutate(
      { resource: 'clientes', values: { nombre } },
      {
        onSuccess: () => navigate('/clientes'),
        onError: (mutationError) => setError(mutationError.message),
      },
    )
  }

  return (
    <Create title="Crear cliente" isLoading={isPending} saveButtonProps={{ style: { display: 'none' } }}>
      <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 480 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Nombre"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            required
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={isPending}>
            {isPending ? 'Guardando…' : 'Crear cliente'}
          </Button>
        </Stack>
      </Box>
    </Create>
  )
}
