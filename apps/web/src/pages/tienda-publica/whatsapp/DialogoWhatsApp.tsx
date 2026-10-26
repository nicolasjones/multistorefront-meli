import { Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { nuevaClaveEnvioWhatsapp, registrarConsultaWhatsapp } from '../../../lib/registroWhatsapp'
import { IconoWhatsapp } from './IconoWhatsapp'

export type PropsDialogoWhatsApp = {
  // Si el diálogo está abierto.
  abierto: boolean
  // Host de la tienda (de acá sale la empresa en la base).
  host: string
  // Producto que se registra en la bandeja.
  productoId: string
  // Empresa y número que se muestran.
  empresa: string
  numero: string
  // Mensaje armado que se muestra y se envía.
  mensaje: string
  // Enlace `wa.me` ya codificado.
  url: string
  // Cierra el diálogo sin efectos.
  onCerrar: () => void
  // Avisa que WhatsApp quedó abierto con el mensaje listo.
  onAviso: () => void
}

// Diálogo «Consultar por WhatsApp» (F-TDA-14, FR-021, FR-023, FR-024, FR-026). Muestra el mensaje que se
// va a enviar (solo lectura), se cierra con «Cancelar», Esc o clic fuera y, con «Abrir WhatsApp», abre
// `wa.me` en una pestaña nueva con `noopener`, registra el interés y avisa que quedó listo.
export default function DialogoWhatsApp({
  abierto,
  host,
  productoId,
  empresa,
  numero,
  mensaje,
  url,
  onCerrar,
  onAviso,
}: PropsDialogoWhatsApp) {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  // Una `clave_envio` por apertura del diálogo (FR-024, FR-004): dos aperturas distintas registran dos
  // consultas; un doble clic sobre «Abrir WhatsApp» no puede registrar la misma apertura dos veces.
  const clave = useRef(nuevaClaveEnvioWhatsapp())
  const registrando = useRef(false)

  useEffect(() => {
    if (!abierto) return
    clave.current = nuevaClaveEnvioWhatsapp()
    registrando.current = false
  }, [abierto])

  const abrir = () => {
    if (registrando.current) return
    registrando.current = true
    // WhatsApp se abre primero y no espera al registro: la acción del visitante no se frena (FR-024).
    window.open(url, '_blank', 'noopener')
    // El registro no bloquea la apertura ni muestra fallas o límite al visitante (FR-024, D3).
    void registrarConsultaWhatsapp(host, productoId, clave.current)
    onCerrar()
    onAviso()
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      fullWidth
      maxWidth="xs"
      aria-labelledby="titulo-whatsapp"
      aria-describedby="linea-whatsapp"
      // Foco inicial dentro del diálogo: el título, que es su nombre accesible (FR-026). Se lo
      // focuses al terminar la apertura porque el contenido del diálogo se monta después (portal).
      TransitionProps={{ onEntered: () => titulo.current?.focus() }}
    >
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              bgcolor: 'success.main',
              color: 'success.contrastText',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconoWhatsapp size={24} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="titulo-whatsapp" component="h2" variant="h6" tabIndex={-1} ref={titulo} sx={{ fontWeight: 700 }}>
              Consultar por WhatsApp
            </Typography>
            <Typography id="linea-whatsapp" color="text.secondary" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {empresa} · {numero}
            </Typography>
          </Box>
        </Box>
        <TextField
          label="Mensaje que se va a enviar"
          value={mensaje}
          multiline
          minRows={3}
          fullWidth
          slotProps={{ input: { readOnly: true } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onCerrar} sx={{ minHeight: (tema) => tema.spacing(5.5), flex: 1, fontWeight: 700 }}>Cancelar</Button>
        <Button color="success" variant="contained" onClick={abrir} sx={{ minHeight: (tema) => tema.spacing(5.5), flex: 1, fontWeight: 700 }}>
          Abrir WhatsApp
        </Button>
      </DialogActions>
    </Dialog>
  )
}
