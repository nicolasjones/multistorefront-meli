import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'

export type Props = {
  // Devuelve cuando terminó de procesar la lectura (para devolverle el foco al campo).
  onEscanear: (codigo: string) => Promise<void> | void
  deshabilitado?: boolean
  error?: string | null
}

// Campo de escaneo (F-VTA-31, FR-002). Un lector USB «tipea» el código y envía Enter: el submit al Enter lo
// resuelve igual que el teclado. Foco automático, y el campo se limpia tras cada lectura.
export function LectorCodigoBarras({ onEscanear, deshabilitado = false, error = null }: Props) {
  const [codigo, setCodigo] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!deshabilitado) entrada.current?.focus()
  }, [deshabilitado])

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    const leido = codigo.trim()
    if (leido === '') return
    setCodigo('')
    try {
      await onEscanear(leido)
    } finally {
      entrada.current?.focus()
    }
  }

  return (
    <Stack component="form" direction={{ xs: 'column', sm: 'row' }} spacing={1} onSubmit={enviar} noValidate>
      <TextField
        inputRef={entrada}
        label="Escaneá o ingresá el código de barras"
        value={codigo}
        onChange={(evento) => setCodigo(evento.target.value)}
        disabled={deshabilitado}
        error={error !== null}
        helperText={error ?? ' '}
        autoFocus
        autoComplete="off"
        fullWidth
        // Sin `aria-label`: el nombre accesible es la etiqueta visible (WCAG 2.5.3 «Label in Name»).
        slotProps={{ htmlInput: { inputMode: 'numeric' } }}
      />
      <Button type="submit" variant="contained" disabled={deshabilitado || codigo.trim() === ''} sx={{ alignSelf: { sm: 'flex-start' }, minHeight: 56 }}>
        Agregar
      </Button>
    </Stack>
  )
}
