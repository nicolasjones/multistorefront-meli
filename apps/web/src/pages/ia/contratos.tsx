import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { List } from '@refinedev/mui'
import { useCallback, useEffect, useState } from 'react'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'

type Contrato = { id: string; codigo: string; version: number; consumidor_codigo: string; estado: string }
const jsonInicial = { entrada: '{}', salida: '{}', clasificacion: '{}', acciones: '[]', verificadores: '[]' }

export function IaContratos() {
  const { isSuperadmin, isLoading } = useIsSuperadmin(); const [contratos, setContratos] = useState<Contrato[]>([]); const [codigo, setCodigo] = useState(''); const [version, setVersion] = useState(1); const [consumidor, setConsumidor] = useState(''); const [estado, setEstado] = useState('borrador'); const [json, setJson] = useState(jsonInicial); const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { const { data, error: consultaError } = await supabaseClient.from('ia_contratos_consumidor').select('id,codigo,version,consumidor_codigo,estado').order('codigo'); if (consultaError) setError(consultaError.message); else setContratos((data ?? []) as Contrato[]) }, [])
  useEffect(() => { if (isSuperadmin) void cargar() }, [cargar, isSuperadmin])
  const guardar = async () => { try { setError(null); const { error: rpcError } = await supabaseClient.rpc('guardar_contrato_ia', { p_codigo: codigo, p_version: version, p_consumidor_codigo: consumidor, p_esquema_entrada: JSON.parse(json.entrada), p_esquema_salida: JSON.parse(json.salida), p_clasificacion_datos: JSON.parse(json.clasificacion), p_acciones_permitidas: JSON.parse(json.acciones), p_verificadores: JSON.parse(json.verificadores), p_estado: estado }); if (rpcError) setError(rpcError.message); else { setCodigo(''); setConsumidor(''); setJson(jsonInicial); await cargar() } } catch { setError('Los campos JSON deben tener un formato válido.') } }
  if (isLoading) return null
  if (!isSuperadmin) return <Alert severity="error" sx={{ m: 2 }}>Esta pantalla es solo para el superadmin de la plataforma.</Alert>
  return <List title="Contratos de IA"><Stack spacing={2}>{error && <Alert severity="error">{error}</Alert>}<TextField label="Código" value={codigo} onChange={(event) => setCodigo(event.target.value)} /><TextField label="Versión" type="number" value={version} onChange={(event) => setVersion(Number(event.target.value))} /><TextField label="Consumidor" value={consumidor} onChange={(event) => setConsumidor(event.target.value)} /><TextField select label="Estado" value={estado} onChange={(event) => setEstado(event.target.value)}><MenuItem value="borrador">Borrador</MenuItem><MenuItem value="aprobado">Aprobado</MenuItem><MenuItem value="retirado">Retirado</MenuItem></TextField>{Object.entries(json).map(([campo, valor]) => <TextField key={campo} label={campo} multiline minRows={2} value={valor} onChange={(event) => setJson((actual) => ({ ...actual, [campo]: event.target.value }))} />)}<Button variant="contained" disabled={!codigo || !consumidor} onClick={() => void guardar()}>Guardar contrato</Button><Typography variant="h6">Contratos registrados</Typography>{contratos.map((contrato) => <Typography key={contrato.id}>{`${contrato.codigo} v${contrato.version} · ${contrato.consumidor_codigo} · ${contrato.estado}`}</Typography>)}</Stack></List>
}
