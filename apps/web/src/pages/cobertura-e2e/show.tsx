// Ficha de épica (specs 022 y 023): componente → épica → historias, cada una
// con miniatura, checklist y reproductor. El video se firma bajo demanda: la
// miniatura pide sólo metadata (`preload="metadata"`), nunca el archivo entero.
import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { tokens } from '../../tema/tokens'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { BUCKET_EVIDENCIAS_E2E, cargarManifiesto, SIN_CLASIFICAR } from './list'
import type { Evidencia, ManifiestoCobertura } from './tipos'

// Runner local del visor (no del producto): si el build no define esta URL, el
// botón no existe. Ver `docs/e2e-app.md`.
const RUNNER = (import.meta.env.VITE_E2E_RUNNER_URL as string | undefined) ?? ''

type EstadoCorrida = {
  estado: 'libre' | 'corriendo' | 'listo' | 'fallido'
  epica?: string
  mensaje?: string
}

// Alto y radio de la barra de progreso: medidas del indicador, no del sistema.
const ALTO_PROGRESO = 8

async function firmarVideo(runId: string, video: string): Promise<string> {
  const { data, error } = await supabaseClient.storage
    .from(BUCKET_EVIDENCIAS_E2E)
    .createSignedUrl(`${runId}/${video}`, 300)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo firmar el video.')
  return data.signedUrl
}

function EstadoItem({ evidencia }: { evidencia: Evidencia }) {
  if (evidencia.estado === 'fallido') return <Typography component="span" color="error"> — E2E fallido en la corrida</Typography>
  if (evidencia.estado === 'omitido') return <Typography component="span" color="text.secondary"> — omitido en esta corrida (sin stack), no cuenta como cubierto</Typography>
  if (!evidencia.video) return <Typography component="span" color="text.secondary"> — cubierto, sin video en esta corrida</Typography>
  return null
}

function Historia({ evidencia, runId }: { evidencia: Evidencia; runId: string }) {
  const [miniatura, setMiniatura] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // La miniatura necesita una URL firmada: se pide al abrir la ficha, pero el
  // elemento de video sólo trae metadata (primer cuadro), no el archivo.
  useEffect(() => {
    let vigente = true
    if (!evidencia.video) return
    firmarVideo(runId, evidencia.video).then(
      (firmada) => { if (vigente) setMiniatura(firmada) },
      () => { /* el botón «Ver video» reintenta y muestra el error */ },
    )
    return () => { vigente = false }
  }, [evidencia.video, runId])

  async function verVideo() {
    if (!evidencia.video) return
    setCargando(true)
    setError(null)
    try {
      setUrl(miniatura ?? (await firmarVideo(runId, evidencia.video)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo firmar el video.')
    } finally {
      setCargando(false)
    }
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
          <Box
            sx={{
              position: 'relative',
              mt: 1,
              borderRadius: `${tokens.forma.radioTarjeta}px`,
              overflow: 'hidden',
              bgcolor: 'grey.900',
              border: '1px solid',
              borderColor: 'divider',
              maxWidth: 560,
            }}
          >
            {miniatura ? (
              <Box
                component="video"
                src={`${miniatura}#t=6`}
                preload="metadata"
                muted
                playsInline
                aria-label={`Miniatura del video de ${evidencia.specTitulo}`}
                sx={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'contain' }}
              />
            ) : (
              <Box sx={{ width: '100%', aspectRatio: '16 / 9' }} />
            )}
            <Button
              variant="contained"
              onClick={verVideo}
              disabled={cargando}
              sx={{ position: 'absolute', inset: 0, m: 'auto', width: 'fit-content', height: 'fit-content' }}
            >
              {cargando ? 'Firmando…' : '▶ Ver video'}
            </Button>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        {url && (
          <Box
            component="video"
            controls
            autoPlay
            src={url}
            sx={{ width: '100%', mt: 1, bgcolor: 'grey.900' }}
            aria-label={`Video de ${evidencia.specTitulo}`}
          />
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
  const [corrida, setCorrida] = useState<EstadoCorrida>({ estado: 'libre' })
  const [lanzada, setLanzada] = useState(false)

  useEffect(() => {
    if (!organizacionId) return
    let cancelled = false
    cargarManifiesto().then(
      ({ manifiesto: m }) => { if (!cancelled) setManifiesto(m) },
      (e: Error) => { if (!cancelled) setError(e.message) },
    )
    return () => { cancelled = true }
  }, [organizacionId])

  useEffect(() => {
    if (!RUNNER) return
    let vivo = true
    const consultar = async () => {
      try {
        const respuesta = await fetch(`${RUNNER}/estado`, { cache: 'no-store' })
        const datos = (await respuesta.json()) as EstadoCorrida
        if (!vivo) return
        setCorrida(datos)
        if (lanzada && datos.estado === 'listo' && datos.epica === epica) {
          setLanzada(false)
          window.location.reload()
        }
      } catch {
        // El runner es local: si está apagado, el visor sigue funcionando.
      }
    }
    void consultar()
    const timer = window.setInterval(consultar, 5000)
    return () => { vivo = false; window.clearInterval(timer) }
  }, [epica, lanzada])

  async function correr() {
    if (!RUNNER || !epica) return
    setLanzada(true)
    setCorrida({ estado: 'corriendo', epica })
    try {
      const respuesta = await fetch(`${RUNNER}/correr`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ epica }),
      })
      if (!respuesta.ok) {
        const detalle = (await respuesta.json().catch(() => ({}))) as { mensaje?: string }
        setLanzada(false)
        setCorrida({ estado: 'fallido', epica, mensaje: detalle.mensaje ?? 'No se pudo lanzar la corrida.' })
      }
    } catch {
      setLanzada(false)
      setCorrida({ estado: 'fallido', epica, mensaje: 'El runner local no responde.' })
    }
  }

  if (checkingPermiso || checkingOrganizacion) return null
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede consultar la cobertura E2E.</Alert>
  if (error) return <Alert severity="warning" sx={{ m: 2 }}>Todavía no hay manifiesto de cobertura. Detalle: {error}</Alert>
  if (!manifiesto) return <Box sx={{ m: 2 }}><CircularProgress aria-label="Cargando cobertura" /></Box>

  const historias = manifiesto.evidencias.filter((e) => e.epica === epica)
  if (historias.length === 0) return <Alert severity="info" sx={{ m: 2 }}>La épica {epica} no tiene evidencias E2E.</Alert>
  const specs = new Set(historias.map((h) => h.spec))
  const pendientes = manifiesto.sin_cubrir.filter((x) => specs.has(x.spec))
  const cubiertos = historias.filter((h) => h.estado !== 'omitido').reduce((n, h) => n + h.items.length, 0)
  const total = cubiertos + pendientes.length
  const porcentaje = total > 0 ? Math.round((cubiertos / total) * 100) : 0
  const componente = historias[0].componente?.trim() || SIN_CLASIFICAR

  return (
    <Stack spacing={2} sx={{ m: 2 }}>
      <Box>
        <Button component={RouterLink} to="/cobertura-e2e" size="small" sx={{ mb: 1 }}>
          ← Volver a componentes
        </Button>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" variant="outlined" label={`Componente: ${componente}`} />
          <Chip size="small" variant="outlined" label={historias[0].epica} />
        </Stack>
        <Typography variant="h5" component="h1" sx={{ mt: 0.5 }}>{historias[0].epicaNombre}</Typography>
        <Typography variant="caption" color="text.secondary">
          {historias.length} {historias.length === 1 ? 'historia' : 'historias'} · {cubiertos} de {total} ítems con E2E · {pendientes.length} sin cubrir · corrida {manifiesto.run_id}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={porcentaje}
          sx={{ height: ALTO_PROGRESO, borderRadius: `${tokens.forma.radioBarra}px`, mt: 1, maxWidth: 420 }}
          aria-label={`${porcentaje}% de los ítems con E2E`}
        />
        {RUNNER && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
            <Button variant="outlined" size="small" onClick={correr} disabled={corrida.estado === 'corriendo'}>
              {corrida.estado === 'corriendo' ? 'Corriendo…' : 'Correr este recorrido'}
            </Button>
            {corrida.estado === 'corriendo' && (
              <Typography variant="caption" color="text.secondary">
                Graba el video y actualiza esta ficha al terminar (unos 10 minutos).
              </Typography>
            )}
            {corrida.estado === 'fallido' && (
              <Typography variant="caption" color="error">{corrida.mensaje ?? 'La corrida falló.'}</Typography>
            )}
          </Stack>
        )}
      </Box>
      {historias.map((h) => <Historia key={`${h.spec}-${h.test}`} evidencia={h} runId={manifiesto.run_id} />)}
      {pendientes.length > 0 && (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary>
            <Typography variant="h6" component="h2">
              Ítems sin E2E ({pendientes.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {pendientes.map((p) => (
                <li key={`${p.spec}-${p.id}`}>
                  <Typography component="span">[{p.id}] {p.texto}</Typography>
                </li>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  )
}
