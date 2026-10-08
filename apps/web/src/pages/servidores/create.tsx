import { type FormEvent, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Create } from '@refinedev/mui'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'

type Organizacion = { id: string; nombre: string }

// No es un create de Refine contra la tabla servidores_organizacion
// directamente: no hay policy de insert/update para authenticated (R11,
// data-model.md) — el único camino es public.aprovisionar_servidor_organizacion
// (US5, FR-014). Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md
export function ServidorCreate() {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()

  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([])
  const [organizacionId, setOrganizacionId] = useState('')
  const [host, setHost] = useState('')
  const [puertoSsh, setPuertoSsh] = useState('22')
  const [usuarioSsh, setUsuarioSsh] = useState('')
  const [credencialSsh, setCredencialSsh] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // La contraseña del rol solo existe acá, en memoria, hasta que la persona
  // la copie — no se guarda en ningún otro lado ni se puede volver a pedir
  // (mismo criterio de UX que cualquier secret manager).
  const [passwordRol, setPasswordRol] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperadmin) return
    supabaseClient
      .from('organizaciones')
      .select('id, nombre')
      .then(({ data }) => setOrganizaciones(data ?? []))
  }, [isSuperadmin])

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

    const { data, error: rpcError } = await supabaseClient
      .rpc('aprovisionar_servidor_organizacion', {
        p_organizacion_id: organizacionId,
        p_host: host,
        p_usuario_ssh: usuarioSsh,
        p_credencial_ssh: credencialSsh,
        p_puerto: Number(puertoSsh) || 22,
      })
      .single<{ password_rol: string }>()

    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    setPasswordRol(data.password_rol)
    setLoading(false)
  }

  if (passwordRol) {
    return (
      <Create title="Servidor aprovisionado" saveButtonProps={{ style: { display: 'none' } }}>
        <Box sx={{ maxWidth: 480 }}>
          <Stack spacing={2}>
            <Alert severity="warning">
              Copiá esta contraseña ahora — es la única vez que se muestra, no
              queda recuperable después.
            </Alert>
            <TextField
              label="Contraseña del rol de base de datos"
              value={passwordRol}
              InputProps={{ readOnly: true }}
              fullWidth
            />
            <Button variant="contained" onClick={() => window.location.assign('/servidores')}>
              Listo, ya la copié
            </Button>
          </Stack>
        </Box>
      </Create>
    )
  }

  return (
    <Create title="Crear servidor de organización" isLoading={loading} saveButtonProps={{ style: { display: 'none' } }}>
      <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 480 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            Da de alta el servidor Docker propio de una organización,
            alcanzable por SSH desde el servidor central. Cada organización
            tiene como máximo un servidor.
          </Typography>
          <TextField
            select
            label="Organización"
            value={organizacionId}
            onChange={(event) => setOrganizacionId(event.target.value)}
            required
            fullWidth
          >
            {organizaciones.map((organizacion) => (
              <MenuItem key={organizacion.id} value={organizacion.id}>
                {organizacion.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            required
            fullWidth
            helperText="Dirección alcanzable por SSH desde el servidor central."
          />
          <TextField
            label="Puerto SSH"
            type="number"
            value={puertoSsh}
            onChange={(event) => setPuertoSsh(event.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Usuario SSH"
            value={usuarioSsh}
            onChange={(event) => setUsuarioSsh(event.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Credencial SSH (clave privada o contraseña)"
            value={credencialSsh}
            onChange={(event) => setCredencialSsh(event.target.value)}
            type="password"
            required
            fullWidth
            multiline
            minRows={3}
          />
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Aprovisionando…' : 'Aprovisionar servidor'}
          </Button>
        </Stack>
      </Box>
    </Create>
  )
}
