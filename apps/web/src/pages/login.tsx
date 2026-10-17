import { type FormEvent, useState } from 'react'
import { useLogin } from '@refinedev/core'
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { MarcoAcceso } from '../components/pagina/MarcoAcceso'
import { tokens } from '../tema/tokens'

// Sin registro propio: no existe ningún flujo de alta de cuenta salvo la
// invitación por email (spec 003, FR-009). El ingreso (F-ACC-01) vive en
// providers/authProvider.ts; esta pantalla solo recoge los datos y muestra la
// notificación que ese provider decide (el error no se repite en un Alert).
export function LoginPage() {
  const { mutateAsync: ingresar, isPending } = useLogin<{
    email: string
    password: string
    remember: boolean
  }>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)

  const enviar = (event: FormEvent) => {
    event.preventDefault()
    ingresar({ email, password, remember }).catch(() => {})
  }

  return (
    <MarcoAcceso>
      <Stack spacing={2} component="form" onSubmit={enviar}>
        <Box>
          <Typography component="h1" variant="t1">Ingresar</Typography>
          <Typography variant="bl" color="text.secondary" sx={{ mt: 0.5 }}>Acceso exclusivo para el equipo interno.</Typography>
        </Box>
        <TextField
          label="Correo electrónico"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          fullWidth
        />
        <TextField
          label="Contraseña"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          fullWidth
        />
        <FormControlLabel
          control={<Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />}
          label="Mantener la sesión iniciada"
        />
        <Button type="submit" variant="contained" size="large" disabled={isPending}>
          {isPending ? 'Ingresando...' : 'Ingresar'}
        </Button>
        <Link component={RouterLink} to="/acceso/solicitar-recuperacion" sx={{ fontSize: tokens.tipografia.escala.b.tamano, fontWeight: tokens.tipografia.pesoEnfasis }}>
          ¿Olvidaste tu contraseña?
        </Link>
      </Stack>
    </MarcoAcceso>
  )
}
