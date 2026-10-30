import { Stack, TextField } from '@mui/material'
import { ASUNTO_MAXIMO, MENSAJE_MAXIMO, type ErroresRedaccion } from '../../lib/correoMasivo'

type Props = {
  asunto: string
  mensaje: string
  onAsunto: (valor: string) => void
  onMensaje: (valor: string) => void
  /** Errores a mostrar; null mientras la persona no intentó enviar. */
  errores: ErroresRedaccion | null
  disabled?: boolean
  /** Prefijo de los ids para que dos instancias en pantalla no repitan ids. */
  idBase: string
}

// Campos «Asunto» y «Mensaje» del correo masivo (F-CLI-12, FR-010/FR-011): los comparten la pantalla «Nueva campaña»
// y el diálogo del listado. El mensaje es texto plano con saltos de línea.
export function CamposRedaccionCorreo({ asunto, mensaje, onAsunto, onMensaje, errores, disabled, idBase }: Props) {
  return (
    <Stack spacing={2}>
      <TextField
        id={`${idBase}-asunto`}
        label="Asunto"
        value={asunto}
        onChange={(evento) => onAsunto(evento.target.value)}
        required
        fullWidth
        size="small"
        disabled={disabled}
        error={Boolean(errores?.asunto)}
        helperText={errores?.asunto ?? `${asunto.length}/${ASUNTO_MAXIMO}`}
        slotProps={{ htmlInput: { maxLength: ASUNTO_MAXIMO + 50 } }}
      />
      <TextField
        id={`${idBase}-mensaje`}
        label="Mensaje"
        value={mensaje}
        onChange={(evento) => onMensaje(evento.target.value)}
        required
        fullWidth
        multiline
        minRows={5}
        disabled={disabled}
        error={Boolean(errores?.mensaje)}
        helperText={errores?.mensaje ?? `${mensaje.length}/${MENSAJE_MAXIMO}. Texto plano: cada correo suma al final un enlace para darse de baja.`}
      />
    </Stack>
  )
}
