// Visor de cobertura E2E por historia (spec 022): lista de épicas.
// Lee `latest/cobertura-e2e.json` del bucket privado `evidencias-e2e` y agrupa
// por épica. Sin manifiesto (bucket vacío o sin secreto en CI) muestra el
// estado vacío con instrucciones, nunca un error críptico.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert, Box, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import type { EpicaResumen, ManifiestoCobertura } from './tipos'

export const BUCKET_EVIDENCIAS_E2E = 'evidencias-e2e'
export const MANIFIESTO_LATEST = 'latest/cobertura-e2e.json'

export async function leerManifiesto(): Promise<ManifiestoCobertura> {
  const { data, error } = await supabaseClient.storage.from(BUCKET_EVIDENCIAS_E2E).download(MANIFIESTO_LATEST)
  if (error || !data) throw new Error(error?.message ?? 'Manifiesto no disponible.')
  return JSON.parse(await data.text()) as ManifiestoCobertura
}

export function resumirPorEpica(manifiesto: ManifiestoCobertura): EpicaResumen[] {
  const porEpica = new Map<string, { nombre: string; historias: Set<string>; items: number; videos: number }>()
  for (const e of manifiesto.evidencias) {
    let resumen = porEpica.get(e.epica)
    if (!resumen) {
      resumen = { nombre: e.epicaNombre, historias: new Set(), items: 0, videos: 0 }
      porEpica.set(e.epica, resumen)
    }
    resumen.historias.add(e.specTitulo)
    resumen.items += e.items.length
    if (e.video) resumen.videos += 1
  }
  return [...porEpica.entries()].map(([epica, r]) => ({ epica, nombre: r.nombre, historias: r.historias.size, items: r.items, videos: r.videos }))
}

export function CoberturaList() {
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

  if (error) {
    return (
      <Stack spacing={1} sx={{ m: 2 }}>
        <Alert severity="warning">
          Todavía no hay manifiesto de cobertura. Generá una corrida con video (local: `pnpm cobertura:e2e`; CI: corre el E2E) y subila al bucket `{BUCKET_EVIDENCIAS_E2E}`.
        </Alert>
        <Typography variant="caption" color="text.secondary">Detalle: {error}</Typography>
      </Stack>
    )
  }
  if (!manifiesto) return <Box sx={{ m: 2 }}><CircularProgress aria-label="Cargando cobertura" /></Box>

  const epicas = resumirPorEpica(manifiesto)
  if (epicas.length === 0) return <Alert severity="info" sx={{ m: 2 }}>El manifiesto no trae evidencias con etiqueta `[EPICA:TASK]`.</Alert>

  return (
    <Stack spacing={1} sx={{ m: 2 }}>
      <Typography variant="h5" component="h1">Cobertura E2E por historia</Typography>
      <Typography variant="caption" color="text.secondary">
        Corrida {manifiesto.run_id} · {new Date(manifiesto.fecha).toLocaleString()} · modo {manifiesto.modo}
      </Typography>
      <List>
        {epicas.map((r) => (
          <ListItem key={r.epica} divider>
            <ListItemText
              primary={<Link to={`/cobertura-e2e/${r.epica}`}>{r.nombre}</Link>}
              secondary={`${r.historias} ${r.historias === 1 ? 'historia' : 'historias'} · ${r.items} ${r.items === 1 ? 'ítem' : 'ítems'} · ${r.videos} ${r.videos === 1 ? 'video' : 'videos'}`}
            />
          </ListItem>
        ))}
      </List>
    </Stack>
  )
}
