import { useState } from 'react'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { ENLACE_BAJA_EJEMPLO, PIE_CORREO_MASIVO, redaccionValida, TEXTO_ENLACE_BAJA, validarRedaccion } from '../../../lib/correoMasivo'
import { useCorreoMasivo } from '../../../hooks/useCorreoMasivo'

type Props = { asunto: string; mensaje: string }

// Vista previa y «Enviar prueba» del correo masivo (F-CLI-12, FR-013/FR-014). La vista previa muestra el correo
// final: el mensaje como texto (React lo escapa; nunca HTML) y el pie fijo con un enlace de baja de EJEMPLO, que
// no se puede abrir. La prueba llega al correo de quien redacta, sin crear campaña ni gastar cupo diario.
export function VistaPreviaCorreo({ asunto, mensaje }: Props) {
  const { enviarPrueba } = useCorreoMasivo()
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const valida = redaccionValida(validarRedaccion(asunto, mensaje))

  const probar = async () => {
    setEnviando(true)
    setResultado(null)
    const respuesta = await enviarPrueba(asunto, mensaje)
    setResultado(respuesta.ok
      ? { ok: true, texto: 'Te enviamos una prueba a tu correo. Puede tardar un minuto en llegar.' }
      : { ok: false, texto: respuesta.error })
    setEnviando(false)
  }

  return (
    <Stack spacing={1.5} component="section" aria-labelledby="vista-previa-titulo">
      <Typography id="vista-previa-titulo" component="h2" variant="t2">Vista previa</Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="s" color="text.secondary">Asunto</Typography>
        <Typography sx={{ fontWeight: 600, mb: 1.5, overflowWrap: 'anywhere' }}>{asunto.trim() === '' ? '—' : asunto}</Typography>
        <Box data-testid="vista-previa-mensaje" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{mensaje.trim() === '' ? '—' : mensaje}</Box>
        <Box component="hr" sx={{ my: 2 }} />
        <Typography variant="s" color="text.secondary" data-testid="vista-previa-pie">
          {PIE_CORREO_MASIVO}{' '}
          <Box component="span" sx={{ textDecoration: 'underline' }} data-testid="vista-previa-enlace" title={`Enlace de ejemplo: ${ENLACE_BAJA_EJEMPLO}`}>
            {TEXTO_ENLACE_BAJA}
          </Box>.
          {' '}(Enlace de ejemplo: en cada correo real es único para cada destinatario.)
        </Typography>
      </Paper>
      <Box>
        <Button variant="outlined" size="small" onClick={() => void probar()} disabled={!valida || enviando}>
          {enviando ? 'Enviando prueba…' : 'Enviar prueba'}
        </Button>
      </Box>
      <Box role="status" aria-live="polite">
        {resultado ? <Alert severity={resultado.ok ? 'success' : 'error'}>{resultado.texto}</Alert> : null}
      </Box>
    </Stack>
  )
}
