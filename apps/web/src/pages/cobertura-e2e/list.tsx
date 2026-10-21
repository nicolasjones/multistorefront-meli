// Visor de cobertura E2E (specs 022 y 023): Componente → Épica → Historia.
// Lee `latest/cobertura-e2e.json` del bucket privado `evidencias-e2e`; si no
// hay bucket configurado cae al manifiesto local `/cobertura-e2e.json` (para
// probar el visor sin secretos) y lo indica con una insignia. Sin ninguno de
// los dos muestra el estado vacío con instrucciones, nunca un error críptico.
import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { tokens } from '../../tema/tokens'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import type { ComponenteResumen, EpicaResumen, EstadoFiltro, ManifiestoCobertura } from './tipos'

export const BUCKET_EVIDENCIAS_E2E = 'evidencias-e2e'
export const MANIFIESTO_LATEST = 'latest/cobertura-e2e.json'
export const MANIFIESTO_LOCAL = '/cobertura-e2e.json'
export const SIN_CLASIFICAR = 'Sin clasificar'

export async function leerManifiesto(): Promise<ManifiestoCobertura> {
  const { data, error } = await supabaseClient.storage.from(BUCKET_EVIDENCIAS_E2E).download(MANIFIESTO_LATEST)
  if (error || !data) throw new Error(error?.message ?? 'Manifiesto no disponible.')
  return JSON.parse(await data.text()) as ManifiestoCobertura
}

/** Respaldo para desarrollo: el mismo JSON servido desde `apps/web/public/`. */
export async function leerManifiestoLocal(): Promise<ManifiestoCobertura> {
  if (typeof fetch !== 'function') throw new Error('Este navegador no puede leer el manifiesto local.')
  const respuesta = await fetch(MANIFIESTO_LOCAL, { cache: 'no-store' })
  if (!respuesta.ok) throw new Error(`No hay manifiesto local (HTTP ${respuesta.status}).`)
  return (await respuesta.json()) as ManifiestoCobertura
}

// Alto y radio de la barra de progreso: medidas del indicador, no del sistema.
const ALTO_PROGRESO = 8

export type OrigenManifiesto = 'bucket' | 'local'

/** Bucket primero; manifiesto local después. Devuelve de dónde salió. */
export async function cargarManifiesto(): Promise<{ manifiesto: ManifiestoCobertura; origen: OrigenManifiesto }> {
  try {
    return { manifiesto: await leerManifiesto(), origen: 'bucket' }
  } catch (delBucket) {
    try {
      return { manifiesto: await leerManifiestoLocal(), origen: 'local' }
    } catch {
      throw delBucket
    }
  }
}

const numero = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`

// Agrupa por componente y resume cada épica con progreso real: ítems con E2E
// sobre el total de la historia (los `sin_cubrir` también cuentan, si no el
// progreso mentiría dando 100% a una historia a medio cubrir).
export function resumirPorComponente(manifiesto: ManifiestoCobertura): ComponenteResumen[] {
  const epicas = new Map<string, EpicaResumen & { specs: Set<string> }>()
  const epicaDeSpec = new Map<string, string>()

  for (const e of manifiesto.evidencias) {
    const componente = e.componente?.trim() || SIN_CLASIFICAR
    let resumen = epicas.get(e.epica)
    if (!resumen) {
      resumen = {
        epica: e.epica,
        nombre: e.epicaNombre,
        componente,
        historias: 0,
        cubiertos: 0,
        total: 0,
        videos: 0,
        fallidos: 0,
        omitidos: 0,
        specs: new Set(),
      }
      epicas.set(e.epica, resumen)
    }
    resumen.specs.add(e.spec)
    epicaDeSpec.set(e.spec, e.epica)
    // Un ítem omitido (sin stack) no cuenta como cubierto.
    if (e.estado !== 'omitido') resumen.cubiertos += e.items.length
    if (e.video) resumen.videos += 1
    if (e.estado === 'fallido') resumen.fallidos += 1
    if (e.estado === 'omitido') resumen.omitidos += 1
  }

  for (const pendiente of manifiesto.sin_cubrir) {
    const epica = epicaDeSpec.get(pendiente.spec)
    if (!epica) continue
    const resumen = epicas.get(epica)
    if (resumen) resumen.total += 1
  }

  const porComponente = new Map<string, EpicaResumen[]>()
  for (const { specs, ...resumen } of epicas.values()) {
    const historias = [...specs]
    const completo = { ...resumen, historias: historias.length, total: resumen.total + resumen.cubiertos }
    const lista = porComponente.get(completo.componente) ?? []
    lista.push(completo)
    porComponente.set(completo.componente, lista)
  }

  return [...porComponente.entries()]
    .map(([componente, lista]) => ({
      componente,
      epicas: [...lista].sort((a, b) => a.epica.localeCompare(b.epica)),
    }))
    .sort((a, b) => a.componente.localeCompare(b.componente))
}

export function estadoDeEpica(resumen: EpicaResumen): Exclude<EstadoFiltro, 'todos'> {
  if (resumen.fallidos > 0) return 'fallido'
  if (resumen.cubiertos >= resumen.total && resumen.total > 0) return 'cubierto'
  return 'parcial'
}

const ETIQUETA_ESTADO: Record<Exclude<EstadoFiltro, 'todos'>, string> = {
  cubierto: 'Cubierto',
  parcial: 'Sin cubrir',
  fallido: 'Fallido',
}

const COLOR_ESTADO: Record<Exclude<EstadoFiltro, 'todos'>, 'success' | 'warning' | 'error'> = {
  cubierto: 'success',
  parcial: 'warning',
  fallido: 'error',
}

// Texto donde busca el buscador: lo que una persona escribiría (nombre de la
// épica, la historia, un ítem o el nombre del test).
function textoDeEpica(manifiesto: ManifiestoCobertura, resumen: EpicaResumen): string {
  const partes: string[] = [resumen.epica, resumen.nombre, resumen.componente]
  const specs = new Set<string>()
  for (const e of manifiesto.evidencias) {
    if (e.epica !== resumen.epica) continue
    specs.add(e.spec)
    partes.push(e.specTitulo, e.test, ...e.items.map((i) => `${i.id} ${i.texto}`))
  }
  for (const p of manifiesto.sin_cubrir) {
    if (!specs.has(p.spec)) continue
    partes.push(`${p.id} ${p.texto}`)
  }
  return partes.join(' ').toLowerCase()
}

export function filtrarComponentes(
  manifiesto: ManifiestoCobertura,
  componentes: ComponenteResumen[],
  busqueda: string,
  estado: EstadoFiltro,
): ComponenteResumen[] {
  const texto = busqueda.trim().toLowerCase()
  return componentes
    .map((c) => ({
      ...c,
      epicas: c.epicas.filter((r) => {
        if (estado !== 'todos' && estadoDeEpica(r) !== estado) return false
        return texto === '' || textoDeEpica(manifiesto, r).includes(texto)
      }),
    }))
    .filter((c) => c.epicas.length > 0)
}

function TarjetaEpica({ resumen }: { resumen: EpicaResumen }) {
  const estado = estadoDeEpica(resumen)
  const porcentaje = resumen.total > 0 ? Math.round((resumen.cubiertos / resumen.total) * 100) : 0
  return (
    <Card variant="outlined">
      <CardActionArea component={RouterLink} to={`/cobertura-e2e/${resumen.epica}`}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Chip size="small" label={resumen.epica} variant="outlined" />
            <Chip size="small" color={COLOR_ESTADO[estado]} label={ETIQUETA_ESTADO[estado]} />
          </Stack>
          <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
            {resumen.nombre}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={porcentaje}
            color={COLOR_ESTADO[estado]}
            sx={{ height: ALTO_PROGRESO, borderRadius: tokens.forma.radioBarra, mb: 0.5 }}
            aria-label={`${porcentaje}% de los ítems con E2E`}
          />
          <Typography variant="caption" color="text.secondary">
            {resumen.cubiertos} de {resumen.total} ítems con E2E ({porcentaje}%)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {numero(resumen.historias, 'historia', 'historias')} · {numero(resumen.videos, 'video', 'videos')}
            {resumen.fallidos > 0 ? ` · ${numero(resumen.fallidos, 'fallido', 'fallidos')}` : ''}
            {resumen.omitidos > 0 ? ` · ${numero(resumen.omitidos, 'omitido', 'omitidos')}` : ''}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export function CoberturaList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [manifiesto, setManifiesto] = useState<ManifiestoCobertura | null>(null)
  const [origen, setOrigen] = useState<'bucket' | 'local' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<EstadoFiltro>('todos')

  useEffect(() => {
    if (!organizacionId) return
    let cancelled = false
    cargarManifiesto().then(
      ({ manifiesto: m, origen: de }) => {
        if (cancelled) return
        setManifiesto(m)
        setOrigen(de)
      },
      (e: Error) => { if (!cancelled) setError(e.message) },
    )
    return () => { cancelled = true }
  }, [organizacionId])

  const componentes = useMemo(() => (manifiesto ? resumirPorComponente(manifiesto) : []), [manifiesto])
  const visibles = useMemo(
    () => (manifiesto ? filtrarComponentes(manifiesto, componentes, busqueda, estado) : []),
    [manifiesto, componentes, busqueda, estado],
  )

  if (checkingPermiso || checkingOrganizacion) return null
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede consultar la cobertura E2E.</Alert>

  if (error) {
    return (
      <Stack spacing={1} sx={{ m: 2 }}>
        <Alert severity="warning">
          Todavía no hay manifiesto de cobertura. Generá una corrida con video (local: `pnpm cobertura:e2e`; CI: corre el E2E) y subila al bucket `{BUCKET_EVIDENCIAS_E2E}` o dejá el JSON en `apps/web/public/cobertura-e2e.json`.
        </Alert>
        <Typography variant="caption" color="text.secondary">Detalle: {error}</Typography>
      </Stack>
    )
  }
  if (!manifiesto || !origen) return <Box sx={{ m: 2 }}><CircularProgress aria-label="Cargando cobertura" /></Box>

  if (componentes.length === 0) return <Alert severity="info" sx={{ m: 2 }}>El manifiesto no trae evidencias con etiqueta `[EPICA:TASK]`.</Alert>

  const cubiertos = componentes.reduce((n, c) => n + c.epicas.reduce((m, e) => m + e.cubiertos, 0), 0)
  const totalItems = componentes.reduce((n, c) => n + c.epicas.reduce((m, e) => m + e.total, 0), 0)
  const porcentajeGlobal = totalItems > 0 ? Math.round((cubiertos / totalItems) * 100) : 0

  return (
    <Stack spacing={2} sx={{ m: 2 }}>
      <Box>
        <Typography variant="h5" component="h1">Cobertura E2E</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Corrida {manifiesto.run_id} · {new Date(manifiesto.fecha).toLocaleString()} · modo {manifiesto.modo}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={origen === 'bucket' ? 'Desde el bucket' : 'Manifiesto local'}
            title={origen === 'bucket' ? MANIFIESTO_LATEST : MANIFIESTO_LOCAL}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {numero(componentes.length, 'componente', 'componentes')} ·{' '}
          {numero(componentes.reduce((n, c) => n + c.epicas.length, 0), 'épica', 'épicas')} ·{' '}
          {cubiertos} de {totalItems} ítems con E2E ({porcentajeGlobal}%)
        </Typography>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          size="small"
          fullWidth
          label="Buscar"
          placeholder="Componente, épica, historia, ítem o test"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <TextField
          size="small"
          select
          label="Estado"
          value={estado}
          onChange={(event) => setEstado(event.target.value as EstadoFiltro)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="todos">Todos</MenuItem>
          <MenuItem value="cubierto">Cubierto</MenuItem>
          <MenuItem value="parcial">Sin cubrir</MenuItem>
          <MenuItem value="fallido">Fallido</MenuItem>
        </TextField>
      </Stack>

      {visibles.length === 0 && (
        <Alert severity="info">Ninguna épica coincide con la búsqueda y el estado elegidos.</Alert>
      )}

      {visibles.map((c) => (
        <Box key={c.componente} component="section" aria-label={`Componente ${c.componente}`}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            {c.componente}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            }}
          >
            {c.epicas.map((r) => <TarjetaEpica key={r.epica} resumen={r} />)}
          </Box>
        </Box>
      ))}
    </Stack>
  )
}
