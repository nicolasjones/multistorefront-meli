import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { mensajeDeError } from '../../lib/clientes'

type Estado = 'cerrado' | 'editando' | 'enviando' | 'listo' | 'error'

// Diálogo «Enviar correo a seleccionados» (prototipo Clientes · Listado): asunto + mensaje,
// se envía solo a los que tienen correo cargado. Solo lo monta quien edita Clientes.
export function CorreoMasivoClientes({ ids, conCorreo }: { ids: string[]; conCorreo: number }) {
  const [estado, setEstado] = useState<Estado>('cerrado')
  const [asunto, setAsunto] = useState('Novedades y promociones de octubre')
  const [mensaje, setMensaje] = useState('')
  const [resultado, setResultado] = useState('')
  const [mensajeError, setMensajeError] = useState('')

  const enviar = async () => {
    if (!asunto.trim() || !mensaje.trim()) {
      setMensajeError('Completá el asunto y el mensaje.')
      setEstado('error')
      return
    }
    setEstado('enviando')
    try {
      const { data, error } = await supabaseClient.functions.invoke<{ enviados: number; sin_correo: number }>(
        'enviar-correo-clientes',
        { body: { ids, asunto: asunto.trim(), mensaje: mensaje.trim() } },
      )
      if (error) throw new Error(error.message)
      const sin = data?.sin_correo ? ` (${data.sin_correo} sin correo no lo recibieron)` : ''
      setResultado(`Correo enviado a ${data?.enviados ?? ids.length} clientes${sin}.`)
      setEstado('listo')
    } catch (error) {
      setMensajeError(mensajeDeError(error, 'No pudimos enviar el correo.'))
      setEstado('error')
    }
  }

  const cerrar = () => setEstado('cerrado')

  return (
    <>
      <Button variant="outlined" disabled={ids.length === 0} onClick={() => setEstado('editando')}>
        {ids.length > 0 ? `Enviar correo a seleccionados (${ids.length})` : 'Enviar correo a seleccionados'}
      </Button>
      <Dialog open={estado !== 'cerrado'} onClose={estado === 'enviando' ? undefined : cerrar} aria-labelledby="correo-masivo-titulo" fullWidth maxWidth="sm">
        <DialogTitle id="correo-masivo-titulo">Enviar correo a seleccionados</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Se envía a los {ids.length} clientes marcados en el listado. Solo reciben el correo quienes tienen un mail cargado.
          </DialogContentText>
          <TextField label="Asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} fullWidth sx={{ mb: 2 }} />
          <TextField label="Mensaje" value={mensaje} onChange={(e) => setMensaje(e.target.value)} multiline minRows={4} fullWidth />
          {estado === 'listo' ? <Alert severity="success" sx={{ mt: 2 }}>{resultado}</Alert> : null}
          {estado === 'error' ? <Alert severity="error" sx={{ mt: 2 }}>{mensajeError}</Alert> : null}
          {conCorreo === 0 && estado === 'editando' ? (
            <Alert severity="warning" sx={{ mt: 2 }}>Ninguno de los seleccionados tiene correo cargado.</Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={estado === 'enviando'}>Cancelar</Button>
          <Button variant="contained" onClick={() => void enviar()} disabled={estado === 'enviando'}>
            {estado === 'enviando' ? 'Enviando…' : 'Enviar correo'}
          </Button>
          {(estado === 'listo' || estado === 'error') && <Button onClick={cerrar}>Cerrar</Button>}
        </DialogActions>
      </Dialog>
    </>
  )
}
