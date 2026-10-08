import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { List } from '@refinedev/mui'
import { Alert, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'

type Ejecucion = {
  id: string
  origen: 'manual' | 'programada' | 'kestra'
  estado: 'en_curso' | 'exitosa' | 'fallida' | 'timeout'
  iniciada_en: string
  finalizada_en: string | null
  motivo_sanitizado: string | null
  capacidades_ejecucion: { clave: string }[] | null
}

function duracion(iniciada: string, finalizada: string | null): string {
  if (!finalizada) return 'en curso'
  const segundos = Math.max(0, Math.round((new Date(finalizada).getTime() - new Date(iniciada).getTime()) / 1000))
  if (segundos < 60) return `${segundos}s`
  return `${Math.floor(segundos / 60)}min ${segundos % 60}s`
}

// Historial de ejecuciones de la organización activa (spec 016, US2/FR-007):
// solo metadatos auditables; el motivo ya viene sanitizado de la base y acá
// nunca se reconstruye ni se muestra un error crudo del worker.
export function EjecucionList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!organizacionId) return
    let cancelled = false
    supabaseClient.from('ejecuciones_worker').select('id, origen, estado, iniciada_en, finalizada_en, motivo_sanitizado, capacidades_ejecucion(clave)').eq('organizacion_id', organizacionId).order('iniciada_en', { ascending: false }).limit(100).then(({ data, error: queryError }) => {
      if (cancelled) return
      if (queryError) setError(queryError.message)
      else setEjecuciones((data ?? []) as Ejecucion[])
    })
    return () => { cancelled = true }
  }, [organizacionId])

  if (checkingPermiso || checkingOrganizacion) return null
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede consultar ejecuciones.</Alert>

  return <List title="Ejecuciones" headerButtons={null}>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {ejecuciones.length === 0 && !error && <Typography color="text.secondary">Todavía no hay ejecuciones registradas para esta organización.</Typography>}
    <TableContainer><Table><TableHead><TableRow><TableCell>Capacidad</TableCell><TableCell>Origen</TableCell><TableCell>Estado</TableCell><TableCell>Duración</TableCell><TableCell>Motivo</TableCell><TableCell align="right">Detalle</TableCell></TableRow></TableHead><TableBody>
      {ejecuciones.map((ejecucion) => <TableRow key={ejecucion.id}><TableCell>{ejecucion.capacidades_ejecucion?.[0]?.clave ?? '—'}</TableCell><TableCell>{ejecucion.origen}</TableCell><TableCell>{ejecucion.estado}</TableCell><TableCell>{duracion(ejecucion.iniciada_en, ejecucion.finalizada_en)}</TableCell><TableCell>{ejecucion.motivo_sanitizado ?? '—'}</TableCell><TableCell align="right"><Button component={RouterLink} to={`/ejecuciones/${ejecucion.id}`} size="small">Ver</Button></TableCell></TableRow>)}
    </TableBody></Table></TableContainer>
  </List>
}
