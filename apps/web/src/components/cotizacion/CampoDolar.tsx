import { InputAdornment, TextField } from '@mui/material'
import { MENSAJE_VALOR_INVALIDO, caracteresDelCampoDolar } from '../../lib/cotizacion'

type Props = {
  texto: string
  onCambiar: (texto: string) => void
  // El texto no es un valor válido (vacío no cuenta): se muestra el mensaje de formato.
  invalido: boolean
  // Ayuda cuando el valor es válido (p. ej. «Anterior: …»).
  ayuda?: string
}

// Campo «Dólar del día (pesos por dólar)» (prototipo): compartido por los diálogos de carga del dólar. Solo admite
// dígitos, punto, coma y «-»; el «-» no se descarta en silencio: un negativo muestra el mensaje de formato inválido.
export function CampoDolar({ texto, onCambiar, invalido, ayuda }: Props) {
  return (
    <TextField
      label="Dólar del día (pesos por dólar)"
      value={texto}
      onChange={(evento) => onCambiar(caracteresDelCampoDolar(evento.target.value))}
      error={invalido}
      helperText={invalido ? MENSAJE_VALOR_INVALIDO : ayuda}
      autoFocus
      slotProps={{
        htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
        input: {
          startAdornment: <InputAdornment position="start">$</InputAdornment>,
          endAdornment: <InputAdornment position="end">por USD</InputAdornment>,
        },
      }}
    />
  )
}
