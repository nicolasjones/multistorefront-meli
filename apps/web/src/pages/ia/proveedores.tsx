import { Alert, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import { List } from '@refinedev/mui'
import { useCallback, useEffect, useState } from 'react'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'

type Proveedor = { codigo: string; nombre: string; habilitado: boolean; retencion_verificada_en: string | null; retencion_verifica_hasta: string | null; evidencia_retencion_url: string | null }
const fechaLocal = (valor: string | null) => valor ? valor.slice(0, 16) : ''

export function IaProveedores() {
  const { isSuperadmin, isLoading } = useIsSuperadmin()
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const { data, error: consultaError } = await supabaseClient.from('ia_proveedores').select('codigo, nombre, habilitado, retencion_verificada_en, retencion_verifica_hasta, evidencia_retencion_url').order('nombre')
    if (consultaError) setError(consultaError.message)
    else setProveedores((data ?? []) as Proveedor[])
  }, [])
  useEffect(() => { if (isSuperadmin) void cargar() }, [cargar, isSuperadmin])
  const actualizar = (codigo: string, cambios: Partial<Proveedor>) => setProveedores((actuales) => actuales.map((proveedor) => proveedor.codigo === codigo ? { ...proveedor, ...cambios } : proveedor))
  const guardar = async (proveedor: Proveedor) => {
    setGuardando(proveedor.codigo); setError(null)
    const { error: rpcError } = await supabaseClient.rpc('configurar_proveedor_ia', { p_codigo: proveedor.codigo, p_habilitado: proveedor.habilitado, p_retencion_verificada_en: proveedor.retencion_verificada_en || null, p_retencion_verifica_hasta: proveedor.retencion_verifica_hasta || null, p_evidencia_retencion_url: proveedor.evidencia_retencion_url || null })
    if (rpcError) setError(rpcError.message)
    else await cargar()
    setGuardando(null)
  }
  if (isLoading) return null
  if (!isSuperadmin) return <Alert severity="error" sx={{ m: 2 }}>Esta pantalla es solo para el superadmin de la plataforma.</Alert>
  return <List title="Proveedores de IA"><Stack spacing={2}><Alert severity="info">Las claves no se cargan ni se muestran aquí. Se aprovisionan desde entorno hacia Vault con el script de plataforma.</Alert>{error && <Alert severity="error">{error}</Alert>}{proveedores.map((proveedor) => <Stack key={proveedor.codigo} spacing={1} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}><Typography variant="h6">{proveedor.nombre}</Typography><FormControlLabel control={<Checkbox checked={proveedor.habilitado} onChange={(event) => actualizar(proveedor.codigo, { habilitado: event.target.checked })} />} label="Habilitado" /><TextField label="Evidencia de retención" type="url" value={proveedor.evidencia_retencion_url ?? ''} onChange={(event) => actualizar(proveedor.codigo, { evidencia_retencion_url: event.target.value })} /><TextField label="Verificada en" type="datetime-local" InputLabelProps={{ shrink: true }} value={fechaLocal(proveedor.retencion_verificada_en)} onChange={(event) => actualizar(proveedor.codigo, { retencion_verificada_en: event.target.value ? new Date(event.target.value).toISOString() : null })} /><TextField label="Vigente hasta" type="datetime-local" InputLabelProps={{ shrink: true }} value={fechaLocal(proveedor.retencion_verifica_hasta)} onChange={(event) => actualizar(proveedor.codigo, { retencion_verifica_hasta: event.target.value ? new Date(event.target.value).toISOString() : null })} /><Button variant="contained" onClick={() => void guardar(proveedor)} disabled={guardando === proveedor.codigo}>{guardando === proveedor.codigo ? 'Guardando…' : 'Guardar proveedor'}</Button></Stack>)}</Stack></List>
}
