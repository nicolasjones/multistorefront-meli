import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { List } from '@refinedev/mui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'

type Credencial = { id: string; nombre: string; proveedor_id: string; activa: boolean }
type Proveedor = { id: string; nombre: string }
type Modelo = { credencial_id: string; modelo_id: string; activo: boolean }
type Perfil = { id: string; credencial_id: string; modelo_id: string; nombre: string; activo: boolean }

export function IaModelos() {
  const { isSuperadmin, isLoading } = useIsSuperadmin()
  const [credenciales, setCredenciales] = useState<Credencial[]>([]); const [proveedores, setProveedores] = useState<Proveedor[]>([]); const [modelos, setModelos] = useState<Modelo[]>([]); const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [credencialId, setCredencialId] = useState(''); const [modeloId, setModeloId] = useState(''); const [nombre, setNombre] = useState(''); const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const [credencialesRespuesta, proveedoresRespuesta, modelosRespuesta, perfilesRespuesta] = await Promise.all([supabaseClient.from('ia_credenciales_proveedor').select('id, nombre, proveedor_id, activa').order('nombre'), supabaseClient.from('ia_proveedores').select('id, nombre').order('nombre'), supabaseClient.from('ia_modelos_descubiertos').select('credencial_id, modelo_id, activo').eq('activo', true).order('modelo_id'), supabaseClient.from('ia_perfiles_modelo').select('id, credencial_id, modelo_id, nombre, activo').order('nombre')])
    const consultaError = credencialesRespuesta.error ?? proveedoresRespuesta.error ?? modelosRespuesta.error ?? perfilesRespuesta.error
    if (consultaError) setError(consultaError.message)
    else { setCredenciales((credencialesRespuesta.data ?? []) as Credencial[]); setProveedores((proveedoresRespuesta.data ?? []) as Proveedor[]); setModelos((modelosRespuesta.data ?? []) as Modelo[]); setPerfiles((perfilesRespuesta.data ?? []) as Perfil[]) }
  }, [])
  useEffect(() => { if (isSuperadmin) void cargar() }, [cargar, isSuperadmin])
  const modelosDisponibles = useMemo(() => modelos.filter((modelo) => modelo.credencial_id === credencialId), [credencialId, modelos])
  const proveedorDe = (credencial: Credencial) => proveedores.find((proveedor) => proveedor.id === credencial.proveedor_id)?.nombre ?? 'Proveedor'
  const crear = async () => { setError(null); const { error: rpcError } = await supabaseClient.rpc('crear_perfil_modelo_ia', { p_credencial_id: credencialId, p_modelo_id: modeloId, p_nombre: nombre, p_activo: true }); if (rpcError) setError(rpcError.message); else { setNombre(''); await cargar() } }
  if (isLoading) return null
  if (!isSuperadmin) return <Alert severity="error" sx={{ m: 2 }}>Esta pantalla es solo para el superadmin de la plataforma.</Alert>
  return <List title="Modelos y perfiles de IA"><Stack spacing={2}><Alert severity="info">Los modelos son descubiertos por el runtime autorizado usando una clave de Vault. Esta pantalla sólo permite elegir modelos ya descubiertos y crear perfiles reutilizables.</Alert>{error && <Alert severity="error">{error}</Alert>}<TextField select label="Credencial aprovisionada" value={credencialId} onChange={(event) => { setCredencialId(event.target.value); setModeloId('') }}>{credenciales.filter((credencial) => credencial.activa).map((credencial) => <MenuItem key={credencial.id} value={credencial.id}>{`${proveedorDe(credencial)} · ${credencial.nombre}`}</MenuItem>)}</TextField><TextField select label="Modelo descubierto" value={modeloId} disabled={!credencialId} onChange={(event) => setModeloId(event.target.value)}>{modelosDisponibles.map((modelo) => <MenuItem key={modelo.modelo_id} value={modelo.modelo_id}>{modelo.modelo_id}</MenuItem>)}</TextField><TextField label="Nombre del perfil" value={nombre} onChange={(event) => setNombre(event.target.value)} /><Button variant="contained" disabled={!credencialId || !modeloId || !nombre.trim()} onClick={() => void crear()}>Crear o actualizar perfil</Button><Typography variant="h6">Perfiles configurados</Typography>{perfiles.map((perfil) => <Typography key={perfil.id}>{`${perfil.nombre}: ${perfil.modelo_id}${perfil.activo ? '' : ' (inactivo)'}`}</Typography>)}</Stack></List>
}
