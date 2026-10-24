import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Link, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { Link as EnlaceRuta, useNavigate } from 'react-router'
import { llegoPorEnlace, olvidarEnlace } from '../../../lib/enlaceAuth'
import { passwordPolicyDescription, passwordRules, validatePassword } from '../../../lib/passwordPolicy'
import { supabaseClient } from '../../../lib/supabase'
import { consultarAcceso, MENSAJE_INGRESO_FALLA, MENSAJE_INGRESO_GENERICO, salirCliente } from '../../../lib/tiendaCuenta'
import { useContextoTienda } from '../layout/LayoutTienda'

const ocultoVisualmente = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: utilidad de accesibilidad (ocultar visualmente manteniendo lectura)

type Enlace = 'verificando' | 'listo' | 'invalido'

// Definir contraseña del cliente (F-CLI-06, FR-022): atiende los enlaces de invitación y de restablecimiento
// (Auth deja la sesión del enlace al abrirlo), aplica `passwordPolicy` y, al terminar, deja al cliente ingresado.
// Un enlace vencido o usado no deja sesión: se muestra un mensaje claro con salida a recuperar. Una sesión abierta
// sin haber llegado por un enlace (navegador compartido) tampoco alcanza: no se cambia la contraseña sin conocerla.
export default function RutaDefinirContrasena() {
  const { host } = useContextoTienda()
  const navigate = useNavigate()
  const [enlace, setEnlace] = useState<Enlace>('verificando')
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    let activa = true
    const fijar = (sesion: unknown) => { if (activa) setEnlace(sesion && llegoPorEnlace() ? 'listo' : 'invalido') }
    // `getSession` espera a que Auth procese el enlace de la URL; sin sesión el enlace venció o ya se usó.
    void supabaseClient.auth.getSession().then(({ data, error: sesionError }) => fijar(sesionError ? null : data.session))
      .catch((cause: unknown) => {
        console.error('definir-contrasena: no se pudo leer la sesión del enlace', cause instanceof Error ? cause.message : cause)
        fijar(null)
      })
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_evento, sesion) => { if (sesion) fijar(sesion) })
    return () => {
      activa = false
      subscription.unsubscribe()
    }
  }, [])

  const definir = async (event: FormEvent) => {
    event.preventDefault()
    const validacion = validatePassword(contrasena, confirmacion)
    if (!validacion.valid) {
      setError(validacion.message)
      return
    }
    setCargando(true)
    setError(null)
    const { error: actualizarError } = await supabaseClient.auth.updateUser({ password: contrasena })
    if (actualizarError) {
      setError('No pudimos guardar la contraseña. Intentá de nuevo.')
      setCargando(false)
      return
    }
    olvidarEnlace()
    // La contraseña cambió: se cierran las demás sesiones de esta cuenta.
    const { error: cerrarError } = await supabaseClient.auth.signOut({ scope: 'others' })
    if (cerrarError) console.error('definir-contrasena: no se cerraron otras sesiones', cerrarError.message)

    // Deja al cliente ingresado solo si su cuenta está activa y habilitada en ESTA tienda (como el ingreso).
    try {
      const acceso = await consultarAcceso(host)
      if (acceso?.estado !== 'activa') {
        await salirCliente()
        setError(MENSAJE_INGRESO_GENERICO)
        setCargando(false)
        return
      }
    } catch (cause) {
      console.error('definir-contrasena: no se pudo consultar el acceso', cause instanceof Error ? cause.message : cause)
      setError(`Tu contraseña se guardó. ${MENSAJE_INGRESO_FALLA}`)
      setCargando(false)
      return
    }
    navigate('/', { replace: true })
  }

  if (enlace === 'verificando') return <CircularProgress aria-label="Validando enlace" sx={{ m: 4 }} />

  if (enlace === 'invalido') {
    return (
      <Box sx={{ maxWidth: 420, mx: 'auto', py: 2 }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 700 }}>Definir contraseña</Typography>
          <Alert severity="warning">El enlace venció o ya se usó. Pedí uno nuevo para continuar.</Alert>
          <Link component={EnlaceRuta} to="/recuperar-contrasena">Recuperar contraseña</Link>
        </Stack>
      </Box>
    )
  }

  const faltan = passwordRules.filter((regla) => !regla.test(contrasena))
  return (
    <Box sx={{ maxWidth: 420, mx: 'auto', py: 2 }}>
      <Stack spacing={2} component="form" onSubmit={definir} aria-labelledby="titulo-definir">
        <Typography id="titulo-definir" component="h1" variant="h5" sx={{ fontWeight: 700 }}>Definir contraseña</Typography>
        <Typography color="text.secondary">{passwordPolicyDescription}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Nueva contraseña"
          type="password"
          value={contrasena}
          onChange={(event) => setContrasena(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          slotProps={{ htmlInput: { 'aria-describedby': 'reglas-contrasena' } }}
        />
        <List id="reglas-contrasena" dense disablePadding aria-label="Reglas de la contraseña">
          {passwordRules.map((regla) => {
            const cumple = regla.test(contrasena)
            return (
              <ListItem key={regla.id} disableGutters>
                <ListItemText
                  primary={`${cumple ? 'Cumple' : 'Falta'}: ${regla.label}`}
                  primaryTypographyProps={{ color: cumple ? 'success.main' : 'text.secondary', variant: 'body2' }}
                />
              </ListItem>
            )
          })}
        </List>
        <Typography role="status" aria-live="polite" sx={ocultoVisualmente}>
          {faltan.length === 0 ? 'La contraseña cumple todas las reglas.' : `Faltan ${faltan.length} de ${passwordRules.length} reglas.`}
        </Typography>
        <TextField
          label="Confirmar contraseña"
          type="password"
          value={confirmacion}
          onChange={(event) => setConfirmacion(event.target.value)}
          autoComplete="new-password"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" size="large" disabled={cargando}>
          {cargando ? 'Guardando...' : 'Guardar y entrar'}
        </Button>
      </Stack>
    </Box>
  )
}
