import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Create } from '@refinedev/mui'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'

export function ConexionCreate() {
  const navigate = useNavigate()
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [sistemaExterno, setSistemaExterno] = useState('')
  const [credencial, setCredencial] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (checkingPermiso || checkingOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede crear conexiones.</Alert>

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null)
    const credencialParaEnvio = credencial
    // La credencial deja el estado de React antes de esperar la RPC.
    setCredencial('')
    const { error: rpcError } = await supabaseClient.rpc('crear_conexion', { p_organizacion_id: organizacionId, p_sistema_externo: sistemaExterno, p_credencial: credencialParaEnvio })
    setLoading(false)
    if (rpcError) { setError(rpcError.message); return }
    navigate('/conexiones')
  }

  return <Create title="Crear conexión" isLoading={loading} saveButtonProps={{ style: { display: 'none' } }}><Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 480 }}><Stack spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    <Typography variant="body2" color="text.secondary">La credencial se cifra en Vault al enviarla. No se conserva en esta pantalla después del envío.</Typography>
    <TextField label="Sistema externo" value={sistemaExterno} onChange={(event) => setSistemaExterno(event.target.value)} required fullWidth />
    <TextField label="Credencial" value={credencial} onChange={(event) => setCredencial(event.target.value)} type="password" required fullWidth multiline minRows={3} />
    <Button type="submit" variant="contained" disabled={loading}>{loading ? 'Guardando…' : 'Guardar conexión'}</Button>
  </Stack></Box></Create>
}
