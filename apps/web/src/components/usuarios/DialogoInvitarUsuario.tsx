import { type FormEvent, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  FormLabel, Link, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import { VIGENCIA_INVITACION, invocarInvitacion } from '../../lib/invitaciones'
import {
  listarEmpresasAsignables, seleccionAArreglo, type EmpresaAsignable, type SeleccionEmpresas,
} from '../../lib/asignacionesEmpresas'
import { SelectorAsignacionesEmpresa } from './SelectorAsignacionesEmpresa'
import { PERMISOS_POR_ROL_DISPONIBLE, ROLES_INVITABLES, rutaPermisosDeRol } from '../../lib/rolesUsuarios'
import { EstadoError, EstadoExito } from '../estados/EstadosPagina'

type Props = { abierto: boolean; onCerrar: () => void; onEnviada?: () => void }

export function DialogoInvitarUsuario({ abierto, onCerrar, onEnviada }: Props) {
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('consulta')
  const [error, setError] = useState<string | null>(null)
  const [enviada, setEnviada] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [empresas, setEmpresas] = useState<EmpresaAsignable[]>([])
  const [seleccion, setSeleccion] = useState<SeleccionEmpresas>({})
  const [errorEmpresas, setErrorEmpresas] = useState(false)

  // F-ROL-07: las empresas entre las que se elige se cargan al abrir el diálogo.
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setErrorEmpresas(false)
    listarEmpresasAsignables()
      .then((lista) => { if (vigente) setEmpresas(lista) })
      .catch(() => { if (vigente) { setEmpresas([]); setErrorEmpresas(true) } })
    return () => { vigente = false }
  }, [abierto])

  const cerrar = () => {
    if (enviando) return
    setEmail(''); setRol('consulta'); setError(null); setEnviada(false); setSeleccion({})
    onCerrar()
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    setEnviando(true); setError(null)
    // El Administrador accede a todas las empresas: no lleva asignaciones.
    const asignaciones = rol !== 'administrador' && empresas.length > 0 ? { asignaciones: seleccionAArreglo(seleccion) } : {}
    const { mensaje } = await invocarInvitacion({ accion: 'invitar', email: email.trim(), rol, ...asignaciones })
    setEnviando(false)
    if (mensaje) { setError(mensaje); return }
    setEnviada(true)
    onEnviada?.()
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-invitar-usuario">
      <Box component="form" onSubmit={enviar}>
        <DialogTitle id="titulo-invitar-usuario">Invitar usuario</DialogTitle>
        <DialogContent>
          {enviada ? (
            <EstadoExito titulo="Invitación enviada" descripcion={`Enviamos un enlace a ${email.trim().toLowerCase()} para definir su contraseña. ${VIGENCIA_INVITACION}`} />
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
              {rol === 'administrador' ? (
                <Typography variant="body2" color="text.secondary">El Administrador accede a todas las empresas: no hace falta asignarlas.</Typography>
              ) : errorEmpresas ? (
                <EstadoError titulo="No pudimos cargar las empresas." descripcion="Podés invitar igual y asignarlas después desde Editar usuario." />
              ) : (
                <SelectorAsignacionesEmpresa empresas={empresas} seleccion={seleccion} onChange={setSeleccion} disabled={enviando} />
              )}
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
