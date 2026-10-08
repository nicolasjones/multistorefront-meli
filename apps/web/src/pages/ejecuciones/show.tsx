import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Show } from '@refinedev/mui'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'

type EjecucionDetalle = {
  id: string
  organizacion_id: string
  origen: string
  estado: string
  actor: string | null
  iniciada_en: string
  finalizada_en: string | null
  motivo_sanitizado: string | null
  detalle: Record<string, unknown>
  archivo_original_path: string | null
  evidencia_path: string | null
  capacidades_ejecucion: { clave: string }[] | null
}

// Detalle de una ejecución con descarga de evidencia (spec 016, US2/FR-007):
// la descarga usa el SDK de Storage con la sesión del administrador (RLS del
// bucket mediante), nunca una service-role key en el navegador.
export function EjecucionShow() {
  const { id } = useParams<{ id: string }>()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [ejecucion, setEjecucion] = useState<EjecucionDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)

  useEffect(() => {
    if (!organizacionId || !id) return
    let cancelled = false
    supabaseClient.from('ejecuciones_worker').select('id, organizacion_id, origen, estado, actor, iniciada_en, finalizada_en, motivo_sanitizado, detalle, archivo_original_path, evidencia_path, capacidades_ejecucion(clave)').eq('id', id).eq('organizacion_id', organizacionId).maybeSingle().then(({ data, error: queryError }) => {
      if (cancelled) return
      if (queryError) setError(queryError.message)
      else if (!data) setError('Ejecución no encontrada en esta organización.')
      else setEjecucion(data as EjecucionDetalle)
    })
    return () => { cancelled = true }
  }, [organizacionId, id])

  async function descargar(ruta: string, nombre: string) {
    setDescargando(ruta)
    setError(null)
    const { data, error: signedUrlError } = await supabaseClient.storage.from('evidencias-ejecuciones').createSignedUrl(ruta, 60)
    if (signedUrlError || !data?.signedUrl) {
      setError(signedUrlError?.message ?? 'No se pudo generar la URL de descarga.')
    } else {
      const enlace = document.createElement('a')
      enlace.href = data.signedUrl
      enlace.download = nombre
      enlace.target = '_blank'
      enlace.rel = 'noreferrer'
      enlace.click()
    }
    setDescargando(null)
  }

  if (checkingPermiso || checkingOrganizacion) return null
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede consultar ejecuciones.</Alert>

  return <Show title="Ejecución" canDelete={false} canEdit={false}>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {ejecucion && <Stack spacing={1} sx={{ mt: 1 }}>
      <Typography><strong>Capacidad:</strong> {ejecucion.capacidades_ejecucion?.[0]?.clave ?? '—'}</Typography>
      <Typography><strong>Origen:</strong> {ejecucion.origen}</Typography>
      <Typography><strong>Estado:</strong> {ejecucion.estado}</Typography>
      <Typography><strong>Iniciada:</strong> {new Date(ejecucion.iniciada_en).toLocaleString()}</Typography>
      <Typography><strong>Finalizada:</strong> {ejecucion.finalizada_en ? new Date(ejecucion.finalizada_en).toLocaleString() : 'en curso'}</Typography>
      <Typography><strong>Motivo:</strong> {ejecucion.motivo_sanitizado ?? '—'}</Typography>
      {ejecucion.actor && <Typography><strong>Iniciada por:</strong> {ejecucion.actor}</Typography>}
      <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
        {ejecucion.archivo_original_path && <Button variant="outlined" disabled={descargando !== null} onClick={() => descargar(ejecucion.archivo_original_path as string, 'original')}>{descargando === ejecucion.archivo_original_path ? 'Descargando…' : 'Descargar archivo original'}</Button>}
        {ejecucion.evidencia_path && <Button variant="contained" disabled={descargando !== null} onClick={() => descargar(ejecucion.evidencia_path as string, 'evidencia')}>{descargando === ejecucion.evidencia_path ? 'Descargando…' : 'Descargar evidencia'}</Button>}
      </Stack>
      {!ejecucion.archivo_original_path && !ejecucion.evidencia_path && <Typography color="text.secondary">Esta ejecución no tiene evidencia adjunta.</Typography>}
    </Stack>}
  </Show>
}
