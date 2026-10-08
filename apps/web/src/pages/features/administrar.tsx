import { useEffect, useState } from 'react'
import { Alert, Box } from '@mui/material'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'
import {
  GrillaFeaturesPorOrganizacion,
  type Feature,
  type Habilitacion,
  type Organizacion,
} from '../../components/GrillaFeaturesPorOrganizacion'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'

// Pantalla superadmin-only (US1): habilitar/deshabilitar funcionalidades del
// catálogo por organización. Sin ningún formulario de alta de
// funcionalidades — a diferencia de analitica/administrar.tsx, el catálogo
// de esta spec solo se puebla desde la migración de la funcionalidad real
// que lo registra (research.md #2, RPC registrar_feature), nunca desde esta
// pantalla.
export function FeaturesAdministrar() {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()

  const [features, setFeatures] = useState<Feature[]>([])
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([])
  const [habilitaciones, setHabilitaciones] = useState<Habilitacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarDatos = async () => {
    setError(null)

    const [featuresRes, organizacionesRes, habilitacionesRes] = await Promise.all([
      supabaseClient.from('features').select('id, nombre'),
      supabaseClient.from('organizaciones').select('id, nombre'),
      supabaseClient.from('organizaciones_features').select('feature_id, organizacion_id'),
    ])

    const primerError = [featuresRes, organizacionesRes, habilitacionesRes].find(
      (res) => res.error,
    )?.error
    if (primerError) {
      setError(primerError.message)
      setCargando(false)
      return
    }

    setFeatures(featuresRes.data ?? [])
    setOrganizaciones(organizacionesRes.data ?? [])
    setHabilitaciones(habilitacionesRes.data ?? [])
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

  const encabezado = <EncabezadoPagina titulo="Funcionalidades — Administrar" descripcion="Habilitá o deshabilitá funcionalidades por organización." />

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

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <GrillaFeaturesPorOrganizacion
          organizaciones={organizaciones}
          features={features}
          habilitaciones={habilitaciones}
          onCambio={cargarDatos}
          onError={setError}
        />
      </ContenedorSeccion>
    </Box>
  )
}
