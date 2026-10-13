import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Checkbox,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { supabaseClient } from '../../lib/supabase'
import {
  ACCIONES_MATRIZ,
  ETIQUETAS_NIVEL,
  ETIQUETAS_ROL,
  ROLES_MATRIZ,
  SECCIONES_MATRIZ,
  guardarMatrizPermisos,
  restablecerMatrizPermisos,
  siguienteNivel,
  type AccionPermiso,
  type CambioAccion,
  type CambioNivel,
  type NivelSeccion,
  type RolMatriz,
} from '../../lib/permisos'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type MapaNiveles = Record<string, NivelSeccion>
type MapaAcciones = Record<string, boolean>

const claveNivel = (rol: string, seccion: string) => `${rol}|${seccion}`
const claveAccion = (rol: string, seccion: string, accion: string) => `${rol}|${seccion}|${accion}`

const RANGO_NIVEL: Record<NivelSeccion, number> = { ninguno: 0, lectura: 1, edicion: 2 }

const COLOR_NIVEL: Record<NivelSeccion, 'success' | 'info' | 'default'> = {
  edicion: 'success',
  lectura: 'info',
  ninguno: 'default',
}

// Matriz de permisos por rol de la organización (F-ROL-02, FR-013…FR-015).
// Solo el Administrador la edita; la verificación real está en las RPC
// guardar_matriz_permisos / restablecer_matriz_permisos (RLS sin escritura directa).
export function RolesPermisos() {
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { contexto, isLoading: cargandoContexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const [descripciones, setDescripciones] = useState<Record<string, string>>({})
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [niveles, setNiveles] = useState<MapaNiveles>({})
  const [acciones, setAcciones] = useState<MapaAcciones>({})
  const [borradorNiveles, setBorradorNiveles] = useState<MapaNiveles>({})
  const [borradorAcciones, setBorradorAcciones] = useState<MapaAcciones>({})
  const [accionActiva, setAccionActiva] = useState<AccionPermiso>('eliminar')
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmandoRestablecer, setConfirmandoRestablecer] = useState(false)
  const [confirmandoGuardar, setConfirmandoGuardar] = useState(false)

  // `recarga` (después de guardar) no reemplaza la pantalla si falla: devuelve false
  // y deja que quien llama distinga «se guardó» de «no pudimos recargar».
  const cargar = useCallback(async (recarga = false): Promise<boolean> => {
    if (!recarga) {
      setCargando(true)
      setErrorCarga(null)
    }
    if (!organizacionId) {
      if (!recarga) {
        setErrorCarga('No hay una organización activa.')
        setCargando(false)
      }
      return false
    }
    const [roles, permisos, permisosAccion, usuarios] = await Promise.all([
      supabaseClient.from('roles_organizacion').select('id, descripcion'),
      supabaseClient.from('permisos_rol').select('rol_id, seccion, nivel'),
      supabaseClient.from('permisos_rol_accion').select('rol_id, seccion, accion, permitido'),
      // La policy deja ver membresías de otras organizaciones (las propias): se filtra por la activa.
      supabaseClient.from('usuarios_organizacion').select('rol_id').eq('organizacion_id', organizacionId),
    ])
    const fallo = [roles, permisos, permisosAccion, usuarios].find((respuesta) => respuesta.error)?.error
    if (fallo) {
      if (!recarga) {
        setErrorCarga(fallo.message)
        setCargando(false)
      }
      return false
    }
    const nuevosNiveles: MapaNiveles = {}
    for (const fila of permisos.data ?? []) {
      nuevosNiveles[claveNivel(fila.rol_id, fila.seccion)] = fila.nivel as NivelSeccion
    }
    const nuevasAcciones: MapaAcciones = {}
    for (const fila of permisosAccion.data ?? []) {
      nuevasAcciones[claveAccion(fila.rol_id, fila.seccion, fila.accion)] = Boolean(fila.permitido)
    }
    const nuevasCantidades: Record<string, number> = {}
    for (const fila of usuarios.data ?? []) {
      nuevasCantidades[fila.rol_id] = (nuevasCantidades[fila.rol_id] ?? 0) + 1
    }
    setDescripciones(Object.fromEntries((roles.data ?? []).map((rol) => [rol.id, rol.descripcion ?? ''])))
    setCantidades(nuevasCantidades)
    setNiveles(nuevosNiveles)
    setAcciones(nuevasAcciones)
    setBorradorNiveles(nuevosNiveles)
    setBorradorAcciones(nuevasAcciones)
    setCargando(false)
    return true
  }, [organizacionId])

  useEffect(() => {
    if (cargandoContexto) return
    void cargar()
  }, [cargar, cargandoContexto])

  const cambiosNiveles = useMemo<CambioNivel[]>(
    () => Object.keys(borradorNiveles)
      .filter((clave) => borradorNiveles[clave] !== niveles[clave])
      .map((clave) => {
        const [rol_id, seccion] = clave.split('|')
        return { rol_id, seccion, nivel: borradorNiveles[clave] }
      }),
    [borradorNiveles, niveles],
  )
  const cambiosAcciones = useMemo<CambioAccion[]>(
    () => Object.keys(borradorAcciones)
      .filter((clave) => borradorAcciones[clave] !== acciones[clave])
      .map((clave) => {
        const [rol_id, seccion, accion] = clave.split('|')
        return { rol_id, seccion, accion: accion as AccionPermiso, permitido: borradorAcciones[clave] }
      }),
    [borradorAcciones, acciones],
  )
  const totalCambios = cambiosNiveles.length + cambiosAcciones.length
  // Cambios que quitan acceso: piden confirmación antes de aplicarse a toda la organización (FR-015).
  const quitanAcceso = useMemo(
    () => cambiosNiveles.some((c) => RANGO_NIVEL[c.nivel] < RANGO_NIVEL[niveles[claveNivel(c.rol_id, c.seccion)] ?? 'ninguno'])
      || cambiosAcciones.some((c) => !c.permitido),
    [cambiosNiveles, cambiosAcciones, niveles],
  )

  const rotar = (rol: RolMatriz, seccion: string) => {
    const clave = claveNivel(rol, seccion)
    setExito(null)
    const nuevoNivel = siguienteNivel(borradorNiveles[clave] ?? 'ninguno')
    setBorradorNiveles((actual) => ({ ...actual, [clave]: nuevoNivel }))
    // Al bajar el nivel se desmarcan las acciones que ya no aplican (puede_accion las ignora):
    // eliminar exige Edición; exportar y ver costos, al menos Solo lectura.
    setBorradorAcciones((actual) => {
      const siguiente = { ...actual }
      for (const { clave: accion } of ACCIONES_MATRIZ) {
        const exige = accion === 'eliminar' ? nuevoNivel !== 'edicion' : nuevoNivel === 'ninguno'
        const claveA = claveAccion(rol, seccion, accion)
        if (exige && siguiente[claveA]) siguiente[claveA] = false
      }
      return siguiente
    })
  }
  const alternarAccion = (rol: RolMatriz, seccion: string) => {
    const clave = claveAccion(rol, seccion, accionActiva)
    setExito(null)
    setBorradorAcciones((actual) => ({ ...actual, [clave]: !actual[clave] }))
  }

  const guardar = async () => {
    setConfirmandoGuardar(false)
    setGuardando(true)
    setErrorAccion(null)
    setExito(null)
    try {
      await guardarMatrizPermisos(cambiosNiveles, cambiosAcciones)
      setExito('Cambios guardados.')
      if (!(await cargar(true))) {
        setErrorAccion('Los cambios se guardaron, pero no pudimos recargar la matriz. Recargá la página para verla actualizada.')
      }
    } catch (error) {
      setErrorAccion(error instanceof Error ? error.message : 'No pudimos guardar los cambios.')
    } finally {
      setGuardando(false)
    }
  }

  const restablecer = async () => {
    setGuardando(true)
    setErrorAccion(null)
    setExito(null)
    try {
      await restablecerMatrizPermisos()
      setConfirmandoRestablecer(false)
      setExito('Valores iniciales restablecidos.')
      if (!(await cargar(true))) {
        // El borrador local ya no corresponde a lo que quedó en el servidor: se descarta.
        setBorradorNiveles(niveles)
        setBorradorAcciones(acciones)
        setErrorAccion('Se restablecieron los valores iniciales, pero no pudimos recargar la matriz. Recargá la página para verla actualizada.')
      }
    } catch (error) {
      setConfirmandoRestablecer(false)
      setErrorAccion(error instanceof Error ? error.message : 'No pudimos restablecer los valores iniciales.')
    } finally {
      setGuardando(false)
    }
  }

  const encabezado = (
    <EncabezadoPagina
      titulo="Roles y permisos"
      descripcion="Definí qué puede ver y editar cada rol en tu organización."
      contexto={<ContextoOrganizacionActiva />}
    />
  )

  if (cargando || verificandoPermiso) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  if (errorCarga) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion><EstadoError descripcion={errorCarga} reintentar={() => void cargar()} /></ContenedorSeccion>
      </Box>
    )
  }

  const editable = puedeEscribir && !guardando

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
        <Stack spacing={3}>
          {!puedeEscribir && (
            <Alert severity="info">Solo un Administrador puede editar los permisos. Estás viendo la matriz en modo lectura.</Alert>
          )}
          {errorAccion && <Alert severity="error" onClose={() => setErrorAccion(null)}>{errorAccion}</Alert>}
          {exito && <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>}

          <Box component="section" aria-label="Roles">
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
              {ROLES_MATRIZ.map((rol) => (
                <Paper key={rol} variant="outlined" sx={{ p: 1.5, minWidth: 180, flex: '1 1 180px' }}>
                  <Typography variant="subtitle1" component="h2">{ETIQUETAS_ROL[rol]}</Typography>
                  <Typography variant="body2" color="text.secondary">{descripciones[rol] ?? ''}</Typography>
                  {puedeEscribir && (
                    <Typography variant="caption">{cantidades[rol] ?? 0} {(cantidades[rol] ?? 0) === 1 ? 'usuario' : 'usuarios'}</Typography>
                  )}
                </Paper>
              ))}
            </Stack>
          </Box>

          <Box component="section" aria-label="Permisos por sección">
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Acceso por sección</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Matriz de permisos por sección">
                <TableHead>
                  <TableRow>
                    <TableCell>Sección</TableCell>
                    {ROLES_MATRIZ.map((rol) => <TableCell key={rol} align="center">{ETIQUETAS_ROL[rol]}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {SECCIONES_MATRIZ.map((seccion) => (
                    <TableRow key={seccion.clave}>
                      <TableCell component="th" scope="row">{seccion.etiqueta}</TableCell>
                      {ROLES_MATRIZ.map((rol) => {
                        const nivel = borradorNiveles[claveNivel(rol, seccion.clave)] ?? 'ninguno'
                        const bloqueado = rol === 'administrador'
                        return (
                          <TableCell key={rol} align="center">
                            <Chip
                              size="small"
                              color={COLOR_NIVEL[nivel]}
                              variant={nivel === 'ninguno' ? 'outlined' : 'filled'}
                              label={ETIQUETAS_NIVEL[nivel]}
                              component="button"
                              type="button"
                              disabled={bloqueado || !editable}
                              onClick={() => rotar(rol, seccion.clave)}
                              aria-label={`${seccion.etiqueta}, ${ETIQUETAS_ROL[rol]}: ${ETIQUETAS_NIVEL[nivel]}${bloqueado ? ' (no editable)' : ''}`}
                            />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          <Box component="section" aria-label="Permisos por acción">
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Acciones sensibles</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={accionActiva}
              onChange={(_, valor: AccionPermiso | null) => valor && setAccionActiva(valor)}
              aria-label="Acción a configurar"
              sx={{ mb: 1 }}
            >
              {ACCIONES_MATRIZ.map((accion) => (
                <ToggleButton key={accion.clave} value={accion.clave}>{accion.etiqueta}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Matriz de permisos por acción">
                <TableHead>
                  <TableRow>
                    <TableCell>Sección</TableCell>
                    {ROLES_MATRIZ.map((rol) => <TableCell key={rol} align="center">{ETIQUETAS_ROL[rol]}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {SECCIONES_MATRIZ.map((seccion) => (
                    <TableRow key={seccion.clave}>
                      <TableCell component="th" scope="row">{seccion.etiqueta}</TableCell>
                      {ROLES_MATRIZ.map((rol) => {
                        // private.puede_accion ignora la acción si el nivel no alcanza:
                        // eliminar exige Edición; exportar y ver costos, al menos Solo lectura.
                        const nivel = borradorNiveles[claveNivel(rol, seccion.clave)] ?? 'ninguno'
                        const sinNivel = accionActiva === 'eliminar' ? nivel !== 'edicion' : nivel === 'ninguno'
                        const etiquetaAccion = ACCIONES_MATRIZ.find((a) => a.clave === accionActiva)?.etiqueta
                        return (
                          <TableCell key={rol} align="center">
                            <Checkbox
                              size="small"
                              checked={rol === 'administrador' || Boolean(borradorAcciones[claveAccion(rol, seccion.clave, accionActiva)])}
                              disabled={rol === 'administrador' || !editable || sinNivel}
                              onChange={() => alternarAccion(rol, seccion.clave)}
                              inputProps={{ 'aria-label': `${etiquetaAccion} en ${seccion.etiqueta}, ${ETIQUETAS_ROL[rol]}${sinNivel ? ' (el nivel de la sección no lo permite)' : ''}` }}
                            />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          {puedeEscribir && (
            <Stack direction="row" spacing={1.5} justifyContent="flex-end" alignItems="center">
              <Typography variant="body2" color="text.secondary" role="status">
                {totalCambios === 0 ? 'Sin cambios pendientes.' : `${totalCambios} ${totalCambios === 1 ? 'cambio pendiente' : 'cambios pendientes'}.`}
              </Typography>
              <Button onClick={() => setConfirmandoRestablecer(true)} disabled={guardando}>Restablecer valores iniciales</Button>
              <Button variant="contained" onClick={() => (quitanAcceso ? setConfirmandoGuardar(true) : void guardar())} disabled={totalCambios === 0 || guardando}>Guardar cambios</Button>
            </Stack>
          )}
        </Stack>
      </ContenedorSeccion>

      <Dialog open={confirmandoGuardar} onClose={() => setConfirmandoGuardar(false)}>
        <DialogTitle>¿Guardar cambios que quitan acceso?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Estos cambios quitan permisos a uno o más roles y se aplican de inmediato a todos los usuarios de tu organización con esos roles.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmandoGuardar(false)} disabled={guardando}>Cancelar</Button>
          <Button color="warning" variant="contained" onClick={() => void guardar()} disabled={guardando}>Guardar cambios</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmandoRestablecer} onClose={() => setConfirmandoRestablecer(false)}>
        <DialogTitle>¿Restablecer valores iniciales?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Se descartan todos los permisos personalizados de tu organización y vuelve la matriz inicial de cada rol. Los cambios pendientes sin guardar también se pierden.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmandoRestablecer(false)} disabled={guardando}>Cancelar</Button>
          <Button color="warning" variant="contained" onClick={() => void restablecer()} disabled={guardando}>Restablecer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
