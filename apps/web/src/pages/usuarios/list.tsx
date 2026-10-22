import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  Chip,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { ETIQUETA_ROL } from '../../lib/permisos'
import {
  asignarEmpresasUsuario, listarAsignaciones, listarEmpresasAsignables, seleccionAArreglo, seleccionDeUsuario,
  seleccionesIguales, type AsignacionDeUsuario, type EmpresaAsignable, type SeleccionEmpresas,
} from '../../lib/asignacionesEmpresas'
import { usePuedeGestionarMembresias } from '../../hooks/usePuedeGestionarMembresias'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { passwordDefinitionRedirectUrl, supabaseClient } from '../../lib/supabase'
import { IdentidadVisible, resolverNombreVisible } from '../../components/identidad/IdentidadVisible'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { SelectorAsignacionesEmpresa } from '../../components/usuarios/SelectorAsignacionesEmpresa'
import { DialogoInvitarUsuario } from '../../components/usuarios/DialogoInvitarUsuario'
import { InvitacionesPendientes } from '../../components/usuarios/InvitacionesPendientes'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Usuario = {
  user_id: string
  rol_id: string
  estado: 'activo' | 'suspendido'
  created_at: string
  nombre: string | null
  apellido: string | null
  ultimo_acceso: string | null
  email: string | null
  es_propio: boolean
}
type Dialogo = { tipo: 'editar' | 'suspender' | 'remover'; usuario: Usuario }

// Los roles de negocio asignables (seis de la épica de roles + Técnico de Service técnico); `miembro` (rol del template) solo se muestra si la persona ya lo tiene.
const ROLES_EDITABLES = ['administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico'] as const

// El alt nunca lleva el user_id crudo -- usa el mismo nombre_visible que la celda de identidad.
function FotoMiembro({ url, nombreVisible }: { url?: string; nombreVisible: string }) {
  return <Avatar src={url} alt={`Foto de ${nombreVisible}`}>{nombreVisible.charAt(0).toUpperCase()}</Avatar>
}

export function UsuarioList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeGestionarMembresias()
  const { contexto } = useContextoPanel()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  // El diálogo conserva su contenido mientras se anima la salida; `dialogoAbierto` solo gobierna la visibilidad.
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [rolElegido, setRolElegido] = useState('')
  const [asignaciones, setAsignaciones] = useState<AsignacionDeUsuario[]>([])
  // Sin asignaciones cargadas no se edita: la selección parte de ellas y guardar reemplaza todo.
  const [asignacionesEstado, setAsignacionesEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')
  const [empresas, setEmpresas] = useState<EmpresaAsignable[]>([])
  const [seleccion, setSeleccion] = useState<SeleccionEmpresas>({})
  const [errorEmpresas, setErrorEmpresas] = useState(false)
  const [cargandoEmpresas, setCargandoEmpresas] = useState(false)
  const aperturaEmpresas = useRef(0)
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [invitando, setInvitando] = useState(false)
  const [versionInvitaciones, setVersionInvitaciones] = useState(0)

  // `cargando` solo cubre la carga inicial: las recargas después de una acción
  // no tapan la tabla con un skeleton. Un error de carga bloquea la pantalla;
  // un error de acción es una alerta sobre la tabla, que sigue visible.
  const cargarUsuarios = useCallback(async () => {
    const { data, error: rpcError } = await supabaseClient.rpc('listar_usuarios_organizacion')

    if (rpcError) {
      setErrorCarga(rpcError.message)
      setCargando(false)
      return
    }

    setErrorCarga(null)
    const filas = (data ?? []) as Usuario[]
    setUsuarios(filas)
    setCargando(false)

    // F-ROL-07: tiendas y rol por tienda; si falla, la columna avisa y «Editar» queda deshabilitado.
    setAsignacionesEstado('cargando')
    listarAsignaciones()
      .then((filasAsignadas) => { setAsignaciones(filasAsignadas); setAsignacionesEstado('ok') })
      .catch(() => setAsignacionesEstado('error'))

    // Una sola llamada para todas las fotos. La ruta se deriva de la membresía
    // autorizada; nunca se consulta perfiles_usuario.
    if (filas.length === 0) return
    const rutas = filas.map((fila) => `${fila.user_id}/avatar`)
    const { data: firmadas } = await supabaseClient.storage.from('fotos-perfil').createSignedUrls(rutas, 60)
    const porUsuario: Record<string, string> = {}
    for (const firmada of firmadas ?? []) {
      if (firmada.signedUrl && firmada.path) porUsuario[firmada.path.replace(/\/avatar$/, '')] = firmada.signedUrl
    }
    setFotos(porUsuario)
  }, [])

  useEffect(() => {
    void cargarUsuarios()
  }, [cargarUsuarios])

  // Una sola vía para las acciones de gestión: la RPC valida Administrador y
  // «al menos un Administrador» en la base; acá solo se informa el resultado.
  const ejecutar = async (usuario: Usuario, rpcNombre: string, args: Record<string, string>, mensaje: string) => {
    setProcesando(usuario.user_id)
    setErrorAccion(null)
    setExito(null)
    const { error: rpcError } = await supabaseClient.rpc(rpcNombre, { p_target_user_id: usuario.user_id, ...args })
    setProcesando(null)

    if (rpcError) {
      setErrorAccion(rpcError.message)
      return false
    }

    setExito(mensaje)
    await cargarUsuarios()
    return true
  }

  const cerrarDialogo = () => {
    setErrorAccion(null)
    setDialogoAbierto(false)
  }

  const abrirDialogo = (tipo: Dialogo['tipo'], usuario: Usuario) => {
    setRolElegido(usuario.rol_id)
    if (tipo === 'editar') {
      setSeleccion(seleccionDeUsuario(asignaciones.filter((a) => a.userId === usuario.user_id)))
      // Solo vale la respuesta de la última apertura: una anterior que llega tarde se descarta.
      const apertura = ++aperturaEmpresas.current
      setErrorEmpresas(false)
      setEmpresas([])
      setCargandoEmpresas(true)
      listarEmpresasAsignables()
        .then((lista) => { if (apertura === aperturaEmpresas.current) setEmpresas(lista) })
        .catch(() => { if (apertura === aperturaEmpresas.current) { setEmpresas([]); setErrorEmpresas(true) } })
        .finally(() => { if (apertura === aperturaEmpresas.current) setCargandoEmpresas(false) })
    }
    setErrorAccion(null)
    setDialogo({ tipo, usuario })
    setDialogoAbierto(true)
  }

  // F-ROL-07: rol de organización y, para quien no es Administrador, empresas y rol por empresa.
  // Dos RPC atómicas cada una; el rol va primero para que la asignación valide contra el rol nuevo.
  const guardarUsuario = async (usuario: Usuario) => {
    const asignacionesActuales = seleccionDeUsuario(asignaciones.filter((a) => a.userId === usuario.user_id))
    const esAdministrador = rolElegido === 'administrador'
    const asignacionesCambian = esAdministrador
      ? Object.keys(asignacionesActuales).length > 0
      : !errorEmpresas && !seleccionesIguales(asignacionesActuales, seleccion)
    if (rolElegido !== usuario.rol_id) {
      const ok = await ejecutar(usuario, 'cambiar_rol_miembro', { p_nuevo_rol: rolElegido }, 'Usuario guardado')
      if (!ok) return false
    }
    if (!asignacionesCambian) {
      if (rolElegido === usuario.rol_id) setExito('Usuario guardado')
      return true
    }
    setProcesando(usuario.user_id)
    setErrorAccion(null)
    try {
      // Administrador accede a todas las empresas: sus asignaciones previas se quitan.
      await asignarEmpresasUsuario(usuario.user_id, esAdministrador ? [] : seleccionAArreglo(seleccion))
    } catch (error) {
      setProcesando(null)
      const detalle = error instanceof Error ? error.message : 'No pudimos guardar las empresas.'
      setErrorAccion(rolElegido !== usuario.rol_id ? `El rol ya se guardó, pero las empresas no: ${detalle}` : detalle)
      await cargarUsuarios()
      return false
    }
    setProcesando(null)
    setExito('Usuario guardado')
    await cargarUsuarios()
    return true
  }

  const confirmar = async () => {
    if (!dialogo) return
    const { tipo, usuario } = dialogo
    const ok = tipo === 'editar'
      ? await guardarUsuario(usuario)
      : tipo === 'suspender'
        ? await ejecutar(usuario, 'suspender_miembro', {}, 'Usuario suspendido')
        : await ejecutar(usuario, 'remover_miembro', {}, 'Usuario removido')
    if (ok) cerrarDialogo()
  }

  // FR-011: el enlace lo envía Supabase Auth al correo de la persona; la respuesta no revela nada más.
  const restablecerContrasena = async (usuario: Usuario) => {
    // FR-006: a un suspendido no se le ofrece ni se le envía el enlace; hay que reactivarlo primero.
    if (!usuario.email || usuario.estado === 'suspendido') return
    setProcesando(usuario.user_id)
    setErrorAccion(null)
    setExito(null)
    const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(usuario.email, {
      redirectTo: passwordDefinitionRedirectUrl('recuperacion', window.location.origin),
    })
    setProcesando(null)
    if (resetError) {
      setErrorAccion('No pudimos enviar el enlace de restablecimiento. Intentá nuevamente más tarde.')
      return
    }
    setExito('Enviamos el enlace para restablecer la contraseña')
    cerrarDialogo()
  }

  const reactivar = (usuario: Usuario) => ejecutar(usuario, 'reactivar_miembro', {}, 'Usuario reactivado')

  const encabezado = <EncabezadoPagina
    titulo="Usuarios"
    descripcion="Personas que entran al panel: invitación, estado, tiendas y rol por tienda. Qué puede hacer cada rol se define en Roles y permisos."
    accion={puedeEscribir ? <Button variant="contained" onClick={() => setInvitando(true)}>Invitar usuario</Button> : undefined}
    contexto={<ContextoOrganizacionActiva />}
    pestanas={<PestanasPagina etiqueta="Administración" pestanas={[{ etiqueta: 'Usuarios', to: '/usuarios' }, { etiqueta: 'Roles y permisos', to: '/roles' }]} />}
  />

  if (cargando) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion>
          <EstadoCargaPagina />
        </ContenedorSeccion>
      </Box>
    )
  }

  if (errorCarga) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion>
          <EstadoError descripcion={errorCarga} reintentar={cargarUsuarios} />
        </ContenedorSeccion>
      </Box>
    )
  }

  const columnas: ColumnaAdaptable<Usuario>[] = [
    {
      clave: 'usuario',
      encabezado: 'Usuario',
      render: (usuario) => (
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FotoMiembro url={fotos[usuario.user_id]} nombreVisible={resolverNombreVisible(usuario).nombreVisible} />
          <IdentidadVisible
            nombre={usuario.nombre}
            apellido={usuario.apellido}
            idTecnico={usuario.user_id}
            puedeCopiarIdTecnico={contexto?.puede_copiar_identificador_tecnico ?? false}
          />
        </Stack>
      ),
    },
    { clave: 'rol', encabezado: 'Rol', render: (usuario) => ETIQUETA_ROL[usuario.rol_id] ?? usuario.rol_id },
    {
      clave: 'empresas',
      encabezado: 'Empresas',
      render: (usuario) => {
        if (usuario.rol_id === 'administrador') return 'Todas las empresas'
        if (asignacionesEstado === 'cargando') return 'Cargando…'
        if (asignacionesEstado === 'error') return 'No pudimos cargar las empresas'
        const propias = asignaciones.filter((a) => a.userId === usuario.user_id)
        if (propias.length === 0) return 'Sin asignar'
        return (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {propias.map((a) => <Chip key={a.empresaId} size="small" variant="outlined" label={`${a.empresaNombre}: ${ETIQUETA_ROL[a.rolId] ?? a.rolId}`} />)}
          </Box>
        )
      },
    },
    { clave: 'ultimo_acceso', encabezado: 'Último acceso', render: (usuario) => (usuario.ultimo_acceso ? new Date(usuario.ultimo_acceso).toLocaleString() : 'Nunca') },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (usuario) => (
        <Chip size="small" color={usuario.estado === 'activo' ? 'success' : 'default'} label={usuario.estado === 'activo' ? 'Activo' : 'Suspendido'} />
      ),
    },
  ]

  const nombreDialogo = dialogo ? resolverNombreVisible(dialogo.usuario).nombreVisible : ''
  const dialogoSuspendido = dialogo?.usuario.estado === 'suspendido'
  const rolesOpciones = dialogo && !(ROLES_EDITABLES as readonly string[]).includes(dialogo.usuario.rol_id)
    ? [dialogo.usuario.rol_id, ...ROLES_EDITABLES]
    : [...ROLES_EDITABLES]

  const asignacionesDialogo = dialogo ? seleccionDeUsuario(asignaciones.filter((a) => a.userId === dialogo.usuario.user_id)) : {}
  const hayCambios = Boolean(dialogo) && (
    rolElegido !== dialogo?.usuario.rol_id
    || (rolElegido === 'administrador'
      ? Object.keys(asignacionesDialogo).length > 0
      : !errorEmpresas && !seleccionesIguales(asignacionesDialogo, seleccion))
  )

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
      <InvitacionesPendientes puedeGestionar={Boolean(puedeEscribir)} version={versionInvitaciones} />
      {errorAccion && !dialogoAbierto && <Alert severity="error" sx={{ mb: 2 }}>{errorAccion}</Alert>}
      {exito && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setExito(null)}>{exito}</Alert>}
      {usuarios.length === 0 ? (
        <EstadoVacio titulo="Todavía no hay usuarios en esta organización." />
      ) : (
        <>
        <BarraHerramientas
          contador={`${usuarios.length} ${usuarios.length === 1 ? 'usuario' : 'usuarios'}`}
          ayuda="El rol por empresa acota lo que cada persona ve. El administrador alcanza todas las empresas."
        />
        <ContenidoAdaptable
          items={usuarios}
          columnas={columnas}
          obtenerClave={(usuario) => usuario.user_id}
          etiquetaTabla="Usuarios"
          acciones={puedeEscribir ? (usuario) => {
            // La base rechaza editarse, suspenderse o removerse a uno mismo (22023): no se ofrece.
            if (usuario.es_propio) return null
            const ocupado = checkingPermiso || procesando === usuario.user_id
            const sinAsignaciones = asignacionesEstado !== 'ok'
            return (
              <>
                <Button size="small" disabled={ocupado || sinAsignaciones} onClick={() => abrirDialogo('editar', usuario)}>Editar</Button>
                {usuario.estado === 'activo' ? (
                  <Button color="warning" size="small" disabled={ocupado} onClick={() => abrirDialogo('suspender', usuario)}>Suspender</Button>
                ) : (
                  <Button size="small" disabled={ocupado} onClick={() => void reactivar(usuario)}>Reactivar</Button>
                )}
                <Button color="error" size="small" disabled={ocupado} onClick={() => abrirDialogo('remover', usuario)}>Remover</Button>
              </>
            )
          } : undefined}
        />
        </>
      )}
      </ContenedorSeccion>
      <DialogoInvitarUsuario abierto={invitando} onCerrar={() => setInvitando(false)} onEnviada={() => setVersionInvitaciones((v) => v + 1)} />
      <Dialog open={dialogoAbierto && dialogo?.tipo === 'editar'} onClose={() => !procesando && cerrarDialogo()}>
        <TituloDialogo onCerrar={() => !procesando && cerrarDialogo()}>Editar usuario</TituloDialogo>
        <DialogContent>
          {errorAccion && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{errorAccion}</Alert>}
          <DialogContentText>{nombreDialogo}</DialogContentText>
          <DialogContentText sx={{ mb: 2 }}>{dialogo?.usuario.email ?? ''}</DialogContentText>
          {dialogoSuspendido && <Alert severity="info" sx={{ mb: 2 }}>Este usuario está suspendido. Reactivalo antes de enviarle el enlace para restablecer la contraseña.</Alert>}
          <TextField select fullWidth size="small" label="Rol" value={rolElegido} onChange={(event) => setRolElegido(event.target.value)}>
            {rolesOpciones.map((rol) => <MenuItem key={rol} value={rol}>{ETIQUETA_ROL[rol] ?? rol}</MenuItem>)}
          </TextField>
          <Box sx={{ mt: 2 }}>
            {rolElegido === 'administrador' ? (
              <DialogContentText>El Administrador accede a todas las empresas: no hace falta asignarlas.</DialogContentText>
            ) : errorEmpresas ? (
              <Alert severity="warning">No pudimos cargar las empresas. Cerrá y volvé a abrir para asignarlas.</Alert>
            ) : (
              <SelectorAsignacionesEmpresa empresas={empresas} seleccion={seleccion} onChange={setSeleccion} disabled={Boolean(procesando)} cargando={cargandoEmpresas} />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => dialogo && void restablecerContrasena(dialogo.usuario)} disabled={Boolean(procesando) || !dialogo?.usuario.email || dialogoSuspendido} sx={{ mr: 'auto' }}>Restablecer contraseña</Button>
          <Button onClick={() => cerrarDialogo()} disabled={Boolean(procesando)}>Cancelar</Button>
          <Button onClick={() => void confirmar()} variant="contained" disabled={Boolean(procesando) || !hayCambios}>
            {procesando ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={dialogoAbierto && dialogo?.tipo === 'suspender'} onClose={() => !procesando && cerrarDialogo()}>
        <TituloDialogo onCerrar={() => !procesando && cerrarDialogo()}>Suspender usuario</TituloDialogo>
        <DialogContent>
          {errorAccion && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{errorAccion}</Alert>}
          <DialogContentText>
            {`${nombreDialogo} no va a poder entrar al panel hasta que lo reactives. Sus cambios anteriores se conservan en Actividad.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => cerrarDialogo()} disabled={Boolean(procesando)}>Cancelar</Button>
          <Button onClick={() => void confirmar()} color="warning" variant="contained" disabled={Boolean(procesando)}>
            {procesando ? 'Suspendiendo…' : 'Suspender'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={dialogoAbierto && dialogo?.tipo === 'remover'} onClose={() => !procesando && cerrarDialogo()}>
        <TituloDialogo onCerrar={() => !procesando && cerrarDialogo()}>Remover usuario</TituloDialogo>
        <DialogContent>
          {errorAccion && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{errorAccion}</Alert>}
          <DialogContentText>{`${nombreDialogo} dejará de pertenecer a la organización.`}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => cerrarDialogo()} disabled={Boolean(procesando)}>Cancelar</Button>
          <Button onClick={() => void confirmar()} color="error" variant="contained" disabled={Boolean(procesando)}>
            {procesando ? 'Removiendo…' : 'Remover'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
