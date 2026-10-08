import { useCallback, useEffect, useState } from 'react'
import { CreateButton } from '@refinedev/mui'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { usePuedeGestionarMembresias } from '../../hooks/usePuedeGestionarMembresias'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { supabaseClient } from '../../lib/supabase'
import { IdentidadVisible, resolverNombreVisible } from '../../components/identidad/IdentidadVisible'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Miembro = {
  user_id: string
  rol_id: string
  created_at: string
  nombre: string | null
  apellido: string | null
}
type CambioPendiente = { miembro: Miembro; nuevoRol: string }

// El alt nunca lleva el user_id crudo -- usa el mismo nombre_visible que la celda de identidad.
function FotoMiembro({ userId, nombreVisible }: { userId: string; nombreVisible: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let activa = true
    // La ruta se deriva de la membresía autorizada; nunca se consulta perfiles_usuario.
    void supabaseClient.storage.from('fotos-perfil').createSignedUrl(`${userId}/avatar`, 60)
      .then(({ data }) => { if (activa) setUrl(data?.signedUrl ?? null) })
    return () => { activa = false }
  }, [userId])

  return <Avatar src={url ?? undefined} alt={`Foto de ${nombreVisible}`}>{nombreVisible.charAt(0).toUpperCase()}</Avatar>
}

export function MiembroList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeGestionarMembresias()
  const { contexto } = useContextoPanel()
  const [miembros, setMiembros] = useState<Miembro[]>([])
  const [rolesPendientes, setRolesPendientes] = useState<Record<string, string>>({})
  const [cambioPendiente, setCambioPendiente] = useState<CambioPendiente | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [removiendo, setRemoviendo] = useState<string | null>(null)

  // `cargando` solo cubre la carga inicial: las recargas después de cambiar
  // rol o remover a alguien no deben tapar la tabla con un skeleton — el
  // usuario ya está viendo el resultado de su acción. Por lo mismo, un error
  // de carga (bloquea toda la pantalla) y un error de acción (alerta arriba
  // de la tabla, que sigue visible) son estados distintos.
  const cargarMiembros = useCallback(async () => {
    const { data, error: rpcError } = await supabaseClient.rpc('listar_miembros_organizacion')

    if (rpcError) {
      setErrorCarga(rpcError.message)
      setCargando(false)
      return
    }

    setErrorCarga(null)
    setMiembros(data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargarMiembros()
  }, [cargarMiembros])

  const confirmarCambio = async () => {
    if (!cambioPendiente) return

    setGuardando(true)
    setErrorAccion(null)
    const { error: rpcError } = await supabaseClient.rpc('cambiar_rol_miembro', {
      p_target_user_id: cambioPendiente.miembro.user_id,
      p_nuevo_rol: cambioPendiente.nuevoRol,
    })

    if (rpcError) {
      setErrorAccion(rpcError.message)
      setGuardando(false)
      return
    }

    setRolesPendientes((actuales) => {
      const siguientes = { ...actuales }
      delete siguientes[cambioPendiente.miembro.user_id]
      return siguientes
    })
    setCambioPendiente(null)
    setGuardando(false)
    await cargarMiembros()
  }

  const removerMiembro = async (miembro: Miembro) => {
    if (!window.confirm('¿Remover a esta persona de la organización?')) return

    setRemoviendo(miembro.user_id)
    setErrorAccion(null)
    const { error: rpcError } = await supabaseClient.rpc('remover_miembro', {
      p_target_user_id: miembro.user_id,
    })

    if (rpcError) {
      setErrorAccion(rpcError.message)
      setRemoviendo(null)
      return
    }

    setRemoviendo(null)
    await cargarMiembros()
  }

  const encabezado = <EncabezadoPagina titulo="Miembros" accion={<CreateButton />} contexto={<ContextoOrganizacionActiva />} />

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
          <EstadoError descripcion={errorCarga} reintentar={cargarMiembros} />
        </ContenedorSeccion>
      </Box>
    )
  }

  const columnas: ColumnaAdaptable<Miembro>[] = [
    { clave: 'foto', encabezado: 'Foto', render: (miembro) => <FotoMiembro userId={miembro.user_id} nombreVisible={resolverNombreVisible(miembro).nombreVisible} /> },
    {
      clave: 'nombre',
      encabezado: 'Nombre',
      render: (miembro) => (
        <IdentidadVisible
          nombre={miembro.nombre}
          apellido={miembro.apellido}
          idTecnico={miembro.user_id}
          puedeCopiarIdTecnico={contexto?.puede_copiar_identificador_tecnico ?? false}
        />
      ),
    },
    {
      clave: 'rol',
      encabezado: 'Rol',
      render: (miembro) => {
        const nuevoRol = rolesPendientes[miembro.user_id] ?? miembro.rol_id
        const { nombreVisible } = resolverNombreVisible(miembro)
        return puedeEscribir ? (
          <TextField
            select
            size="small"
            aria-label={`Rol de ${nombreVisible}`}
            value={nuevoRol}
            onChange={(event) => setRolesPendientes((actuales) => ({
              ...actuales,
              [miembro.user_id]: event.target.value,
            }))}
          >
            <MenuItem value="miembro">Miembro</MenuItem>
            <MenuItem value="administrador">Administrador</MenuItem>
          </TextField>
        ) : miembro.rol_id
      },
    },
    { clave: 'incorporado', encabezado: 'Incorporado', render: (miembro) => new Date(miembro.created_at).toLocaleString() },
  ]

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
      {errorAccion && <Alert severity="error" sx={{ mb: 2 }}>{errorAccion}</Alert>}
      {miembros.length === 0 ? (
        <EstadoVacio titulo="Todavía no hay miembros en esta organización." />
      ) : (
        <ContenidoAdaptable
          items={miembros}
          columnas={columnas}
          obtenerClave={(miembro) => miembro.user_id}
          etiquetaTabla="Miembros"
          acciones={puedeEscribir ? (miembro) => {
            const nuevoRol = rolesPendientes[miembro.user_id] ?? miembro.rol_id
            return (
              <>
                <Button
                  size="small"
                  disabled={checkingPermiso || nuevoRol === miembro.rol_id}
                  onClick={() => setCambioPendiente({ miembro, nuevoRol })}
                >
                  Cambiar rol
                </Button>
                <Button
                  color="error"
                  size="small"
                  disabled={checkingPermiso || removiendo === miembro.user_id}
                  onClick={() => removerMiembro(miembro)}
                >
                  {removiendo === miembro.user_id ? 'Removiendo…' : 'Remover'}
                </Button>
              </>
            )
          } : undefined}
        />
      )}
      </ContenedorSeccion>
      <Dialog open={Boolean(cambioPendiente)} onClose={() => !guardando && setCambioPendiente(null)}>
        <DialogTitle>Confirmar cambio de rol</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`¿Cambiar el rol de esta persona a ${cambioPendiente?.nuevoRol ?? ''}?`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCambioPendiente(null)} disabled={guardando}>Cancelar</Button>
          <Button onClick={confirmarCambio} variant="contained" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
