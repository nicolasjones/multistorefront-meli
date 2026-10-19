import { type FormEvent, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField } from '@mui/material'
import {
  ASUNTO_CORREO_MAX,
  MENSAJE_CORREO_MAX,
  enviarCorreoProveedor,
} from '../../lib/proveedores'
import { EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  proveedor: { id: string; razon_social: string; correo: string | null }
  onCerrar: () => void
  onEnviado: () => void
}

// Diálogo «Enviar correo a proveedor» (prototipo Proveedores · Listado / Ficha; MSF-525). `Para` es solo
// lectura: el servidor envía al correo guardado del proveedor, no a una dirección elegida en el navegador.
export function EnviarCorreoProveedorDialog({ open, proveedor, onCerrar, onEnviado }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-enviar-correo-proveedor">
      {/* Se monta al abrir: cada apertura parte vacía. */}
      <Formulario proveedor={proveedor} onCerrar={onCerrar} onEnviado={onEnviado} />
    </Dialog>
  )
}

function Formulario({ proveedor, onCerrar, onEnviado }: Omit<Props, 'open'>) {
  const [asunto, setAsunto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [errores, setErrores] = useState<{ asunto?: string; mensaje?: string }>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enVuelo = useRef(false)
  const refAsunto = useRef<HTMLInputElement | null>(null)
  const refMensaje = useRef<HTMLTextAreaElement | null>(null)

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos: { asunto?: string; mensaje?: string } = {}
    if (asunto.trim() === '') nuevos.asunto = 'Ingresá el asunto.'
    else if (asunto.trim().length > ASUNTO_CORREO_MAX) nuevos.asunto = `Máximo ${ASUNTO_CORREO_MAX} caracteres.`
    if (mensaje.trim() === '') nuevos.mensaje = 'Escribí el mensaje.'
    else if (mensaje.trim().length > MENSAJE_CORREO_MAX) nuevos.mensaje = `Máximo ${MENSAJE_CORREO_MAX} caracteres.`
    setErrores(nuevos)
    if (nuevos.asunto) { refAsunto.current?.focus(); return }
    if (nuevos.mensaje) { refMensaje.current?.focus(); return }
    enVuelo.current = true
    setEnviando(true)
    try {
      const resultado = await enviarCorreoProveedor({ proveedorId: proveedor.id, asunto, mensaje })
      if (resultado.ok) onEnviado()
      else setErrorServidor(resultado.mensaje)
    } finally {
      enVuelo.current = false
      setEnviando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-enviar-correo-proveedor" onCerrar={enviando ? undefined : onCerrar}>
        Enviar correo a proveedor
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? <EstadoError titulo="No se envió el correo." descripcion={errorServidor} /> : null}
          <TextField
            label="Para"
            value={proveedor.correo ?? ''}
            slotProps={{ input: { readOnly: true } }}
            helperText={`Correo de ${proveedor.razon_social}. Se edita desde la ficha del proveedor.`}
            fullWidth
          />
          <TextField
            label="Asunto"
            value={asunto}
            onChange={(event) => { setAsunto(event.target.value); setErrores((actual) => ({ ...actual, asunto: undefined })) }}
            inputRef={refAsunto}
            error={Boolean(errores.asunto)}
            helperText={errores.asunto}
            required
            autoFocus
            fullWidth
          />
          <TextField
            label="Mensaje"
            value={mensaje}
            onChange={(event) => { setMensaje(event.target.value); setErrores((actual) => ({ ...actual, mensaje: undefined })) }}
            inputRef={refMensaje}
            error={Boolean(errores.mensaje)}
            helperText={errores.mensaje}
            required
            multiline
            minRows={5}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar correo'}
        </Button>
      </DialogActions>
    </Box>
  )
}
