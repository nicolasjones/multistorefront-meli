import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Box, Button, MenuItem, Stack, TextField } from '@mui/material'
import { Create } from '@refinedev/mui'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabaseClient } from '../../lib/supabase'

export function MiembroCreate() {
  const navigate = useNavigate(); const [email, setEmail] = useState(''); const [rol, setRol] = useState('miembro'); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(null); const { error: invokeError } = await supabaseClient.functions.invoke('invitar-miembro', { body: { email, rol } }); if (invokeError) { let message = invokeError.message; if (invokeError instanceof FunctionsHttpError) message = (await invokeError.context.json().catch(() => null))?.error ?? message; setError(message); setLoading(false); return }; navigate('/miembros') }
  return <Create title="Incorporar miembro" isLoading={loading} saveButtonProps={{ style: { display: 'none' } }}><Box component="form" onSubmit={submit} sx={{ maxWidth: 480 }}><Stack spacing={2}>{error && <Alert severity="error">{error}</Alert>}<TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><TextField select label="Rol" value={rol} onChange={(event) => setRol(event.target.value)}><MenuItem value="miembro">Miembro</MenuItem><MenuItem value="administrador">Administrador</MenuItem></TextField><Button type="submit" variant="contained" disabled={loading}>{loading ? 'Incorporando…' : 'Incorporar'}</Button></Stack></Box></Create>
}
