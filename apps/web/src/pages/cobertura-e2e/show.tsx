// Ficha de épica (spec 022, US2/US3): agregación + historias con checklist y video.
// El video se firma bajo demanda (carga diferida): la ficha nunca descarga
// videos hasta que se pide ver uno.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { BUCKET_EVIDENCIAS_E2E, leerManifiesto } from './list'
import type { Evidencia, ManifiestoCobertura } from './tipos'

function EstadoItem({ evidencia }: { evidencia: Evidencia }) {
  if (evidencia.estado === 'fallido') return <Typography component="span" color="error"> — E2E fallido en la corrida</Typography>
  if (evidencia.estado === 'omitido') return <Typography component="span" color="text.secondary"> — omitido en esta corrida (sin stack), no cuenta como cubierto</Typography>
  if (!evidencia.video) return <Typography component="span" color="text.secondary"> — cubierto, sin video en esta corrida</Typography>
  return null
}

function Historia({ evidencia, runId }: { evidencia: Evidencia; runId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verVideo() {
    if (!evidencia.video) return
    setCargando(true)
    setError(null)
    const { data, error: signedError } = await supabaseClient.storage
      .from(BUCKET_EVIDENCIAS_E2E)
      .createSignedUrl(`${runId}/${evidencia.video}`, 300)
    setCargando(false)
    if (signedError || !data?.signedUrl) setError(signedError?.message ?? 'No se pudo firmar el video.')
    else setUrl(data.signedUrl)
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h2">{evidencia.specTitulo}</Typography>
        <Typography variant="caption" color="text.secondary">{evidencia.test}</Typography>
        <Box component="ul" sx={{ pl: 2 }}>
          {evidencia.items.map((item) => (
            <li key={item.id}>
              <Typography component="span">
                [{item.id}] {item.texto}
                {item.hecho ? ' ✓' : ' (pendiente en tasks.md)'}
                {item.ambiguo ? ' — clave repetida en la épica, revisar' : ''}
              </Typography>
              <EstadoItem evidencia={evidencia} />
            </li>
          ))}
        </Box>
        {evidencia.video && !url && (
          <Button variant="outlined" size="small" onClick={verVideo} disabled={cargando}>
            {cargando ? 'Firmando…' : 'Ver video'}
          </Button>
        )}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        {url && (
          <Box component="video" controls src={url} sx={{ width: '100%', mt: 1 }} aria-label={`Video de ${evidencia.specTitulo}`} />
        )}
      </CardContent>
    </Card>
  )
}

export function CoberturaShow() {
  const { id: epica } = useParams<{ id: string }>()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [manifiesto, setManifiesto] = useState<ManifiestoCobertura | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!organizacionId) return
    let cancelled = false
    leerManifiesto().then(
      (m) => { if (!cancelled) setManifiesto(m) },
      (e: Error) => { if (!cancelled) setError(e.message) },
    )
    return () => { cancelled = true }
  }, [organizacionId])

  if (checkingPermiso || checkingOrganizacion) return null
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede consultar la cobertura E2E.</Alert>
  if (error) return <Alert severity="warning" sx={{ m: 2 }}>Todavía no hay manifiesto de cobertura. Detalle: {error}</Alert>
  if (!manifiesto) return <Box sx={{ m: 2 }}><CircularProgress aria-label="Cargando cobertura" /></Box>

  const historias = manifiesto.evidencias.filter((e) => e.epica === epica)
  if (historias.length === 0) return <Alert severity="info" sx={{ m: 2 }}>La épica {epica} no tiene evidencias E2E.</Alert>
  const pendientes = manifiesto.sin_cubrir.filter((x) => historias.some((h) => h.spec === x.spec))
  const cubiertos = historias.reduce((n, h) => n + h.items.length, 0)

  return (
    <Stack spacing={2} sx={{ m: 2 }}>
      <Box>
        <Typography variant="h5" component="h1">{historias[0].epicaNombre}</Typography>
        <Typography variant="caption" color="text.secondary">
          {historias.length} {historias.length === 1 ? 'historia' : 'historias'} · {cubiertos} ítems con E2E · {pendientes.length} sin cubrir · corrida {manifiesto.run_id}
        </Typography>
      </Box>
      {historias.map((h) => <Historia key={`${h.spec}-${h.test}`} evidencia={h} runId={manifiesto.run_id} />)}
      {pendientes.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" component="h2">Ítems sin E2E</Typography>
            <Box component="ul" sx={{ pl: 2 }}>
              {pendientes.map((p) => (
                <li key={`${p.spec}-${p.id}`}>
                  <Typography component="span">[{p.id}] {p.texto} ({p.specTitulo})</Typography>
                </li>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}
