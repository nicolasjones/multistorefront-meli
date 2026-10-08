import { type FormEvent, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { supabaseClient } from '../../lib/supabase'
import { GrillaPermisosPorRol, type RolOrganizacion } from '../../components/GrillaPermisosPorRol'
import { CopiarIdentificadorTecnico } from '../../components/identidad/IdentidadVisible'
import { EstadoCargaPagina, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'

type Organizacion = { id: string; nombre: string }

type Reporte = {
  id: string
  superset_dashboard_uuid: string
  nombre: string
  rolesDefault: string[]
  organizacionesAsignadas: Organizacion[]
}

// Pantalla superadmin-only (US1): catálogo de reportes, su visibilidad por
// rol por defecto, y a qué organizaciones están asignados. La creación del
// reporte en sí (dataset/chart/dashboard) ocurre en Superset, fuera de
// este producto (Assumptions de la spec) — acá solo se registra el UUID de
// embedding ya preparado.
export function AnaliticaAdministrar() {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()
  const { contexto } = useContextoPanel()

  const [roles, setRoles] = useState<RolOrganizacion[]>([])
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([])
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [nuevoUuid, setNuevoUuid] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoDefault, setNuevoDefault] = useState<string[]>([])
  const [registrando, setRegistrando] = useState(false)

  const cargarDatos = async () => {
    setError(null)

    const [rolesRes, orgsRes, reportesRes, defaultRes, asignacionesRes] = await Promise.all([
      supabaseClient.from('roles_organizacion').select('id, descripcion'),
      supabaseClient.from('organizaciones').select('id, nombre'),
      supabaseClient.from('reportes').select('id, superset_dashboard_uuid, nombre'),
      supabaseClient.from('reportes_roles_default').select('reporte_id, rol_id'),
      supabaseClient
        .from('reportes_organizaciones')
        .select('reporte_id, organizacion_id, organizaciones (id, nombre)'),
    ])

    const primerError = [rolesRes, orgsRes, reportesRes, defaultRes, asignacionesRes].find(
      (res) => res.error,
    )?.error
    if (primerError) {
      setError(primerError.message)
      setCargando(false)
      return
    }

    const reportesBase = reportesRes.data ?? []
    const defaults = defaultRes.data ?? []
    const asignaciones = asignacionesRes.data ?? []

    setRoles(rolesRes.data ?? [])
    setOrganizaciones(orgsRes.data ?? [])
    setReportes(
      reportesBase.map((reporte) => ({
        ...reporte,
        rolesDefault: defaults
          .filter((fila) => fila.reporte_id === reporte.id)
          .map((fila) => fila.rol_id),
        organizacionesAsignadas: asignaciones
          .filter((fila) => fila.reporte_id === reporte.id)
          .map((fila) => fila.organizaciones as unknown as Organizacion)
          .filter(Boolean),
      })),
    )
    setCargando(false)
  }

  useEffect(() => {
    if (isSuperadmin) {
      cargarDatos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin])

  if (checkingSuperadmin) {
    return <EstadoCargaPagina />
  }

  if (!isSuperadmin) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Esta pantalla es solo para el superadmin de la plataforma.
      </Alert>
    )
  }

  const handleRegistrar = async (event: FormEvent) => {
    event.preventDefault()
    setRegistrando(true)
    setError(null)

    const { error: rpcError } = await supabaseClient.rpc('registrar_reporte', {
      p_superset_dashboard_uuid: nuevoUuid,
      p_nombre: nuevoNombre,
      p_roles_default: nuevoDefault,
    })

    setRegistrando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setNuevoUuid('')
    setNuevoNombre('')
    setNuevoDefault([])
    await cargarDatos()
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Analítica — Administrar" descripcion="Catálogo de reportes, visibilidad por rol y asignación a organizaciones." />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          Registrar un reporte
        </Typography>
        <Box component="form" onSubmit={handleRegistrar}>
          <Stack spacing={2} sx={{ maxWidth: 560 }}>
            <TextField
              label="UUID de embedding del dashboard (Superset)"
              value={nuevoUuid}
              onChange={(event) => setNuevoUuid(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Nombre a mostrar"
              value={nuevoNombre}
              onChange={(event) => setNuevoNombre(event.target.value)}
              required
              fullWidth
            />
            <Typography variant="body2" color="text.secondary">
              Visibilidad por rol por defecto — se copia a cada organización
              recién al momento de asignarle este reporte.
            </Typography>
            <GrillaPermisosPorRol
              roles={roles}
              rolesSeleccionados={nuevoDefault}
              onChange={setNuevoDefault}
            />
            <Button type="submit" variant="contained" disabled={registrando} sx={{ alignSelf: 'flex-start' }}>
              {registrando ? 'Registrando…' : 'Registrar reporte'}
            </Button>
          </Stack>
        </Box>
      </Paper>

      {cargando ? (
        <ContenedorSeccion>
          <EstadoCargaPagina />
        </ContenedorSeccion>
      ) : reportes.length === 0 ? (
        <ContenedorSeccion>
          <EstadoVacio titulo="Todavía no hay reportes registrados." />
        </ContenedorSeccion>
      ) : (
        <Stack spacing={2}>
          {reportes.map((reporte) => (
            <ReporteRow
              key={reporte.id}
              reporte={reporte}
              roles={roles}
              organizaciones={organizaciones}
              onCambio={cargarDatos}
              onError={setError}
              puedeCopiarIdTecnico={contexto?.puede_copiar_identificador_tecnico ?? false}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}

type ReporteRowProps = {
  reporte: Reporte
  roles: RolOrganizacion[]
  organizaciones: Organizacion[]
  onCambio: () => Promise<void>
  onError: (mensaje: string) => void
  puedeCopiarIdTecnico: boolean
}

function ReporteRow({ reporte, roles, organizaciones, onCambio, onError, puedeCopiarIdTecnico }: ReporteRowProps) {
  const [rolesDefault, setRolesDefault] = useState(reporte.rolesDefault)
  const [guardandoDefault, setGuardandoDefault] = useState(false)
  const [organizacionAAsignar, setOrganizacionAAsignar] = useState('')
  const [asignando, setAsignando] = useState(false)

  const organizacionesDisponibles = organizaciones.filter(
    (organizacion) => !reporte.organizacionesAsignadas.some((asignada) => asignada.id === organizacion.id),
  )

  const handleGuardarDefault = async () => {
    setGuardandoDefault(true)
    const { error } = await supabaseClient.rpc('establecer_roles_default_reporte', {
      p_reporte_id: reporte.id,
      p_roles_id: rolesDefault,
    })
    setGuardandoDefault(false)
    if (error) {
      onError(error.message)
      return
    }
    await onCambio()
  }

  const handleAsignar = async () => {
    if (!organizacionAAsignar) {
      return
    }
    setAsignando(true)
    const { error } = await supabaseClient.rpc('asignar_reporte', {
      p_reporte_id: reporte.id,
      p_organizacion_id: organizacionAAsignar,
    })
    setAsignando(false)
    if (error) {
      onError(error.message)
      return
    }
    setOrganizacionAAsignar('')
    await onCambio()
  }

  const handleDesasignar = async (organizacionId: string) => {
    const { error } = await supabaseClient.rpc('desasignar_reporte', {
      p_reporte_id: reporte.id,
      p_organizacion_id: organizacionId,
    })
    if (error) {
      onError(error.message)
      return
    }
    await onCambio()
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="subtitle1">{reporte.nombre}</Typography>
        {/* El UUID de embedding queda oculto -- copiable solo por superadmin, nunca texto permanente. */}
        <CopiarIdentificadorTecnico
          idTecnico={reporte.superset_dashboard_uuid}
          puedeCopiar={puedeCopiarIdTecnico}
          etiqueta={reporte.nombre}
        />
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      <Typography variant="body2" gutterBottom>
        Visibilidad por defecto (nuevas asignaciones)
      </Typography>
      <GrillaPermisosPorRol roles={roles} rolesSeleccionados={rolesDefault} onChange={setRolesDefault} />
      <Button size="small" onClick={handleGuardarDefault} disabled={guardandoDefault} sx={{ mt: 1 }}>
        {guardandoDefault ? 'Guardando…' : 'Guardar default'}
      </Button>

      <Divider sx={{ my: 1.5 }} />

      <Typography variant="body2" gutterBottom>
        Organizaciones asignadas
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        {reporte.organizacionesAsignadas.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ninguna todavía.
          </Typography>
        )}
        {reporte.organizacionesAsignadas.map((organizacion) => (
          <Chip
            key={organizacion.id}
            label={organizacion.nombre}
            onDelete={() => handleDesasignar(organizacion.id)}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Select
          size="small"
          displayEmpty
          value={organizacionAAsignar}
          onChange={(event) => setOrganizacionAAsignar(event.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">
            <em>Elegir organización…</em>
          </MenuItem>
          {organizacionesDisponibles.map((organizacion) => (
            <MenuItem key={organizacion.id} value={organizacion.id}>
              {organizacion.nombre}
            </MenuItem>
          ))}
        </Select>
        <Button
          size="small"
          variant="outlined"
          disabled={!organizacionAAsignar || asignando}
          onClick={handleAsignar}
        >
          {asignando ? 'Asignando…' : 'Asignar'}
        </Button>
      </Stack>
    </Paper>
  )
}
