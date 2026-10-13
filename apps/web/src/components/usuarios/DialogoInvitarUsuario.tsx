import { type FormEvent, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  FormLabel, Link, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import { VIGENCIA_INVITACION, invocarInvitacion } from '../../lib/invitaciones'
import { PERMISOS_POR_ROL_DISPONIBLE, ROLES_INVITABLES, rutaPermisosDeRol } from '../../lib/rolesUsuarios'
import { EstadoError, EstadoExito } from '../estados/EstadosPagina'

type Props = { abierto: boolean; onCerrar: () => void; onEnviada?: () => void }

export function DialogoInvitarUsuario({ abierto, onCerrar, onEnviada }: Props) {
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('consulta')
  const [error, setError] = useState<string | null>(null)
  const [enviada, setEnviada] = useState(false)
  const [agregadaDirecto, setAgregadaDirecto] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const cerrar = () => {
    if (enviando) return
    setEmail(''); setRol('consulta'); setError(null); setEnviada(false); setAgregadaDirecto(false)
    onCerrar()
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    setEnviando(true); setError(null)
    const { mensaje, resultado } = await invocarInvitacion({ accion: 'invitar', email: email.trim(), rol })
    setEnviando(false)
    if (mensaje) { setError(mensaje); return }
    setAgregadaDirecto(resultado === 'miembro_agregado')
    setEnviada(true)
    onEnviada?.()
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-invitar-usuario">
      <Box component="form" onSubmit={enviar}>
        <DialogTitle id="titulo-invitar-usuario">Invitar usuario</DialogTitle>
        <DialogContent>
          {enviada ? (
            agregadaDirecto
              ? <EstadoExito titulo="Usuario agregado" descripcion={`${email.trim().toLowerCase()} ya tenía una cuenta y se sumó a la organización con el rol elegido. No se envió ningún enlace.`} />
              : <EstadoExito titulo="Invitación enviada" descripcion={`Enviamos un enlace a ${email.trim().toLowerCase()} para definir su contraseña. ${VIGENCIA_INVITACION}`} />
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error && <EstadoError titulo="No pudimos enviar la invitación." descripcion={error} />}
              <TextField label="Correo electrónico" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" required autoFocus />
              <FormControl>
                <FormLabel id="rol-invitado">Rol</FormLabel>
                <RadioGroup aria-labelledby="rol-invitado" value={rol} onChange={(event) => setRol(event.target.value)}>
                  {ROLES_INVITABLES.map((opcion) => (
                    <Box key={opcion.id} sx={{ mb: 1 }}>
                      <FormControlLabel
                        value={opcion.id}
                        control={<Radio />}
                        label={<Box><Typography component="span" fontWeight={600}>{opcion.nombre}</Typography><Typography variant="body2" color="text.secondary">{opcion.descripcion}</Typography></Box>}
                      />
                      {PERMISOS_POR_ROL_DISPONIBLE && (
                        <Link component={RouterLink} to={rutaPermisosDeRol(opcion.id)} variant="body2" sx={{ ml: 4 }} aria-label={`Ver permisos de este rol → ${opcion.nombre}`}>
                          Ver permisos de este rol →
                        </Link>
                      )}
                    </Box>
                  ))}
                </RadioGroup>
              </FormControl>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={enviando}>{enviada ? 'Cerrar' : 'Cancelar'}</Button>
          {!enviada && <Button type="submit" variant="contained" disabled={enviando || !email.trim()}>{enviando ? 'Enviando…' : 'Enviar invitación'}</Button>}
        </DialogActions>
      </Box>
    </Dialog>
  )
}
