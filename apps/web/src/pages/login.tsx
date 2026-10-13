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

// Sin registro propio: no existe ningún flujo de alta de cuenta salvo la
// invitación por email (spec 003, FR-009). El ingreso (F-ACC-01) vive en
// providers/authProvider.ts; esta pantalla solo recoge los datos y muestra el
// mensaje genérico o de bloqueo que ese provider decide y Refine notifica.
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
    // El aviso de un ingreso fallido (credenciales, bloqueo o excepción) lo abre
    // Refine por su notificationProvider; la página no lo repite en un <Alert>.
    ingresar({ email, password, remember }).catch(() => {})
  }

  return (
    <Box component="main" sx={{ maxWidth: 420, mx: 'auto', mt: 8, px: 2 }}>
      <Stack spacing={2} component="form" onSubmit={enviar}>
        <Typography component="h1" variant="h4">
          Ingresar
        </Typography>
        <TextField
          label="Correo"
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
        <Button type="submit" variant="contained" disabled={isPending}>
          {isPending ? 'Ingresando...' : 'Ingresar'}
        </Button>
        <Link component={RouterLink} to="/acceso/solicitar-recuperacion">
          ¿Olvidaste tu contraseña?
        </Link>
      </Stack>
    </Box>
  )
}
