import { useState } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { MarcoAcceso } from '../components/pagina/MarcoAcceso'
import { supabaseClient } from '../lib/supabase'

type Estado = 'confirmar' | 'procesando' | 'hecha' | 'error'

// Página pública de baja del correo masivo (F-CLI-12, FR-019): el enlace del pie de cada correo trae un token único
// (`/baja-correo/:token`). La baja se confirma con un botón (un visor de enlaces no debe dar de baja a nadie) y la
// resuelve la Edge Function anónima `baja-correo-masivo`, que responde igual exista o no el token: el mensaje es
// siempre genérico y no revela si el enlace era válido ni a quién pertenece.
export function BajaCorreoPage() {
  const { token = '' } = useParams()
  const [estado, setEstado] = useState<Estado>('confirmar')

  const darDeBaja = async () => {
    setEstado('procesando')
    const { error } = await supabaseClient.functions.invoke('baja-correo-masivo', { body: { token } })
    if (error) {
      console.error('baja-correo: no se pudo procesar la baja', error.message)
      setEstado('error')
      return
    }
    setEstado('hecha')
  }

  return (
    <MarcoAcceso>
      <Stack spacing={2}>
        <Typography component="h1" variant="t1">Darte de baja del correo masivo</Typography>
        {estado === 'hecha' ? (
          <Alert severity="success" role="status">
            Listo: no vas a recibir más correos masivos. Si hay algún envío en curso, tampoco te va a llegar.
          </Alert>
        ) : (
          <>
            <Typography variant="bl" color="text.secondary">
              Confirmá que no querés recibir más correos masivos de esta tienda. Podés volver a pedirlos cuando quieras.
            </Typography>
            {estado === 'error' ? (
              <Alert severity="error" role="alert">No pudimos procesar la baja. Probá de nuevo en un rato.</Alert>
            ) : null}
            <Button variant="contained" size="large" onClick={() => void darDeBaja()} disabled={estado === 'procesando'}>
              {estado === 'procesando' ? 'Procesando…' : 'Darme de baja'}
            </Button>
          </>
        )}
      </Stack>
    </MarcoAcceso>
  )
}
