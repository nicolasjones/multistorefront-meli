import { AuthPage } from '@refinedev/mui'
import { Link, Stack } from '@mui/material'
import { Link as RouterLink } from 'react-router'

// Sin registro ni "olvidé mi contraseña" propio: no existe ningún flujo de
// alta de cuenta salvo la invitación por email (spec 003, FR-009). Ver
// providers/authProvider.ts.
export function LoginPage() {
  return (
    <Stack spacing={1} alignItems="center">
      <AuthPage type="login" registerLink={false} forgotPasswordLink={false} />
      <Link component={RouterLink} to="/acceso/solicitar-recuperacion">
        Olvide mi contrasena
      </Link>
    </Stack>
  )
}
