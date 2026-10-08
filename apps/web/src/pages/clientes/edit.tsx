import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import { Alert, Box, Button, Stack, TextField } from '@mui/material'
import { Edit } from '@refinedev/mui'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'

type Cliente = { id: string; nombre: string }

// Solo alcanzable desde la UI si administrador (US3) — RLS rechaza igual
// si un miembro llega acá por otra vía (clientes_update exige
// private.puede_escribir()).
export function ClienteEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { query } = useOne<Cliente>({ resource: 'clientes', id })
  const { mutate, mutation } = useUpdate()
  const isPending = mutation.isPending

  const [nombre, setNombre] = useState('')
  const [nombreSincronizadoDe, setNombreSincronizadoDe] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // Ajuste de estado durante el render (no en un efecto): una vez por
  // registro cargado, no en cada re-render.
  if (query.data?.data && nombreSincronizadoDe !== id) {
    setNombre(query.data.data.nombre)
    setNombreSincronizadoDe(id)
  }

  if (checkingPermiso) {
    return null
  }

  if (!puedeEscribir) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Solo un administrador puede editar clientes.
      </Alert>
    )
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    mutate(
      { resource: 'clientes', id, values: { nombre } },
      {
        onSuccess: () => navigate('/clientes'),
        onError: (mutationError) => setError(mutationError.message),
      },
    )
  }

  return (
    <Edit
      title="Editar cliente"
      isLoading={query.isLoading || isPending}
      saveButtonProps={{ style: { display: 'none' } }}
    >
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
            {isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </Stack>
      </Box>
    </Edit>
  )
}
