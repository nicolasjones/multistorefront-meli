import { useEffect, useState } from 'react'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useGetIdentity } from '@refinedev/core'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { GrillaPermisosPorRol, type RolOrganizacion } from '../../components/GrillaPermisosPorRol'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Identity = { id: string; email?: string }

type ReporteAsignado = {
  id: string
  nombre: string
  rolesAsignados: string[]
}

// US3: el administrador de una organización (o el superadmin con esa
// organización activa) ajusta, solo para la suya, qué roles ven cada
// reporte ya asignado — reutiliza GrillaPermisosPorRol (T010, la misma que
// administrar.tsx usa para el default global). Esta pantalla nunca toca el
// default global (FR-005): solo llama establecer_roles_reporte_organizacion.
//
// "Organización activa del usuario" se resuelve igual que
// private.organizacion_id() en la migración (coalesce de la membresía
// directa y, si es superadmin, su organización activa) — necesario porque
// la RLS de reportes_organizaciones deja pasar TODAS las filas a un
// superadmin (is_superadmin() en el using), así que sin este filtro
// explícito vería la asignación de cualquier organización, no solo la
// activa.
export function AnaliticaPermisos() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { data: identity, isLoading: identityLoading } = useGetIdentity<Identity>()

  const [organizacionId, setOrganizacionId] = useState<string | null>(null)
  const [roles, setRoles] = useState<RolOrganizacion[]>([])
  const [reportes, setReportes] = useState<ReporteAsignado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarDatos = async (orgId: string) => {
    setError(null)

    const [rolesRes, asignacionesRes, rolesAsignadosRes] = await Promise.all([
      supabaseClient.from('roles_organizacion').select('id, descripcion'),
      supabaseClient
        .from('reportes_organizaciones')
        .select('reporte_id, reportes (id, nombre)')
        .eq('organizacion_id', orgId),
      supabaseClient
        .from('reportes_organizaciones_roles')
        .select('reporte_id, rol_id')
        .eq('organizacion_id', orgId),
    ])

    const primerError = [rolesRes, asignacionesRes, rolesAsignadosRes].find((res) => res.error)?.error
    if (primerError) {
      setError(primerError.message)
      setCargando(false)
      return
    }

    const rolesAsignadosPorReporte = rolesAsignadosRes.data ?? []

    setRoles(rolesRes.data ?? [])
    setReportes(
      (asignacionesRes.data ?? [])
        .map((fila) => fila.reportes as unknown as { id: string; nombre: string } | null)
        .filter((reporte): reporte is { id: string; nombre: string } => Boolean(reporte))
        .map((reporte) => ({
          id: reporte.id,
          nombre: reporte.nombre,
          rolesAsignados: rolesAsignadosPorReporte
            .filter((fila) => fila.reporte_id === reporte.id)
            .map((fila) => fila.rol_id),
        })),
    )
    setCargando(false)
  }

  useEffect(() => {
    if (!identity?.id) {
      return
    }

    let cancelled = false

    Promise.all([
      supabaseClient
        .from('usuarios_organizacion')
        .select('organizacion_id')
        .eq('user_id', identity.id)
        .maybeSingle(),
      supabaseClient
        .from('superadmin_organizacion_activa')
        .select('organizacion_id')
        .eq('user_id', identity.id)
        .maybeSingle(),
    ]).then(([membresia, organizacionActiva]) => {
      if (cancelled) {
        return
      }

      const orgId = membresia.data?.organizacion_id ?? organizacionActiva.data?.organizacion_id ?? null
      setOrganizacionId(orgId)

      if (orgId) {
        cargarDatos(orgId)
      } else {
        setCargando(false)
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.id])

  if (checkingPermiso || identityLoading) {
    return null
  }

  if (!puedeEscribir) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Solo un administrador puede ajustar la visibilidad de los reportes.
      </Alert>
    )
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Analítica — Permisos" contexto={<ContextoOrganizacionActiva />} />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!cargando && reportes.length === 0 && (
        <ContenedorSeccion>
          <Typography color="text.secondary">
            Todavía no hay reportes asignados a tu organización.
          </Typography>
        </ContenedorSeccion>
      )}

      <Stack spacing={2}>
        {reportes.map((reporte) => (
          <ReportePermisosRow
            key={reporte.id}
            reporte={reporte}
            roles={roles}
            organizacionId={organizacionId as string}
            onError={setError}
            onGuardado={() => cargarDatos(organizacionId as string)}
          />
        ))}
      </Stack>
    </Box>
  )
}

type ReportePermisosRowProps = {
  reporte: ReporteAsignado
  roles: RolOrganizacion[]
  organizacionId: string
  onError: (mensaje: string) => void
  onGuardado: () => Promise<void>
}

function ReportePermisosRow({
  reporte,
  roles,
  organizacionId,
  onError,
  onGuardado,
}: ReportePermisosRowProps) {
  const [rolesSeleccionados, setRolesSeleccionados] = useState(reporte.rolesAsignados)
  const [guardando, setGuardando] = useState(false)

  const handleGuardar = async () => {
    setGuardando(true)
    const { error } = await supabaseClient.rpc('establecer_roles_reporte_organizacion', {
      p_reporte_id: reporte.id,
      p_organizacion_id: organizacionId,
      p_roles_id: rolesSeleccionados,
    })
    setGuardando(false)

    if (error) {
      onError(error.message)
      return
    }

    await onGuardado()
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        {reporte.nombre}
      </Typography>
      <GrillaPermisosPorRol
        roles={roles}
        rolesSeleccionados={rolesSeleccionados}
        onChange={setRolesSeleccionados}
      />
      <Button size="small" onClick={handleGuardar} disabled={guardando} sx={{ mt: 1 }}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </Button>
    </Paper>
  )
}
