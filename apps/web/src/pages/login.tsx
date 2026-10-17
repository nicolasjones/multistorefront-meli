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
import { tokens } from '../../tema/tokens'

const { color, tipografia, forma } = tokens

// Panel de marca del ingreso (Login.dc.html): oscuro, a la izquierda, oculto en
// pantallas angostas. Sólo presentación; no conoce datos ni permisos.
const TIENDAS = ['San Javucho', 'Mundo JC', '+ futuras stores']

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
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 560,
          flexShrink: 0,
          bgcolor: color.sider.fondo,
          color: color.superficie,
          p: 6,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={{
              width: forma.anchoIconButton,
              height: forma.altoIconButton,
              borderRadius: `${forma.radioMenu}px`,
              bgcolor: color.accion,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: tipografia.titulos,
              fontWeight: 700,
            }}
          >
            GC
          </Box>
          <Typography sx={{ fontFamily: tipografia.titulos, fontWeight: 600, fontSize: tipografia.escala.bl.tamano }}>
            Gestión comercial
          </Typography>
        </Stack>
        <Box>
          <Typography
            component="h2"
            sx={{
              fontFamily: tipografia.titulos,
              fontSize: tipografia.escala.hero.tamano,
              fontWeight: tipografia.escala.hero.peso,
              lineHeight: tipografia.escala.hero.interlineado,
              letterSpacing: tipografia.escala.hero.espaciado,
              maxWidth: 420,
            }}
          >
            Un catálogo. Varias tiendas. Un solo panel.
          </Typography>
          <Typography sx={{ mt: 2, fontSize: tipografia.escala.bl.tamano, lineHeight: 1.55, color: color.sider.itemTexto, maxWidth: 400 }}>
            Productos, stock, stores, Mercado Libre y rentabilidad, en un mismo lugar.
          </Typography>
          <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" sx={{ mt: 3.5 }}>
            {TIENDAS.map((nombre) => (
              <Box
                key={nombre}
                component="span"
                sx={{
                  bgcolor: color.sider.itemHover,
                  color: color.sider.itemTextoActivo,
                  borderRadius: `${forma.radioEtiqueta}px`,
                  px: 1.75,
                  py: 0.75,
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: tipografia.escala.s.tamano,
                  fontWeight: 600,
                }}
              >
                {nombre}
              </Box>
            ))}
          </Stack>
        </Box>
        <Typography sx={{ color: color.sider.label, fontSize: tipografia.escala.xs.tamano }}>© 2026 · Panel interno</Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Stack spacing={2} component="form" onSubmit={enviar} sx={{ width: '100%', maxWidth: 440 }}>
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
          <Link component={RouterLink} to="/acceso/solicitar-recuperacion" sx={{ fontSize: tipografia.escala.b.tamano, fontWeight: tipografia.pesoEnfasis }}>
            ¿Olvidaste tu contraseña?
          </Link>
        </Stack>
      </Box>
    </Box>
  )
}
