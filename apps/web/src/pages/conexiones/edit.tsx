import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Edit } from '@refinedev/mui'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'

export function ConexionEdit() {
  const { id } = useParams(); const navigate = useNavigate()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [nuevaCredencial, setNuevaCredencial] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null)
  if (checkingPermiso || checkingOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId || !id) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede rotar credenciales.</Alert>
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null)
    const credencialParaEnvio = nuevaCredencial; setNuevaCredencial('')
    const { error: rpcError } = await supabaseClient.rpc('actualizar_credencial_conexion', { p_conexion_id: id, p_nueva_credencial: credencialParaEnvio })
    setLoading(false)
    if (rpcError) { setError(rpcError.message); return }
    navigate('/conexiones')
  }
  return <Edit title="Rotar credencial" isLoading={loading} saveButtonProps={{ style: { display: 'none' } }}><Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 480 }}><Stack spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    <Typography variant="body2" color="text.secondary">La credencial actual no se muestra ni se recupera para edición. Ingresá la nueva para rotarla en Vault.</Typography>
    <TextField label="Nueva credencial" value={nuevaCredencial} onChange={(event) => setNuevaCredencial(event.target.value)} type="password" required fullWidth multiline minRows={3} />
    <Button type="submit" variant="contained" disabled={loading}>{loading ? 'Rotando…' : 'Rotar credencial'}</Button>
  </Stack></Box></Edit>
}
