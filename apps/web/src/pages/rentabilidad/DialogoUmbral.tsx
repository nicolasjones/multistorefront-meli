import { type FormEvent, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { useUmbralMargen } from '../../hooks/useRentabilidad'
import { MENSAJE_UMBRAL_INVALIDO, parsearUmbralPct, soloCaracteresDeUmbral, umbralATexto } from '../../lib/rentabilidad'

type Props = {
  onCerrar: () => void
  onGuardado: () => void
}

// Diálogo «Umbral de margen bajo» (F-REN-02, FR-018). No está en el prototipo: usa el patrón de sus
// diálogos (campo con `%`, `Cancelar`, `Guardar`). Se ofrece solo con `edicion` (la base lo exige
// igual) y el rango real lo valida la base; acá se da feedback mientras se escribe. El dueño lo MONTA
// al abrir y lo desmonta al cerrar: cada apertura relee el umbral vigente.
export function DialogoUmbral({ onCerrar, onGuardado }: Props) {
  const { umbral, hayError, guardando, recargar, guardar } = useUmbralMargen()
  // null = el usuario todavía no escribió: el campo muestra el valor vigente.
  const [texto, setTexto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valorCampo = texto ?? (umbral ? umbralATexto(umbral.umbral) : '')
  const nuevo = parsearUmbralPct(valorCampo)
  const mostrarInvalido = valorCampo.trim() !== '' && nuevo === null

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (nuevo === null || guardando) return
    setError(null)
    const resultado = await guardar(nuevo)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    onGuardado()
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-umbral-margen">
      <form onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id="titulo-umbral-margen" onCerrar={guardando ? undefined : onCerrar}>Umbral de margen bajo</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {hayError ? <EstadoError descripcion="No pudimos leer el umbral vigente." reintentar={() => void recargar()} /> : null}
            {!umbral && !hayError ? <EstadoCargaPagina lineas={1} /> : null}
            {umbral ? (
              <TextField
                label="Umbral de margen bajo"
                value={valorCampo}
                onChange={(evento) => setTexto(soloCaracteresDeUmbral(evento.target.value))}
                error={mostrarInvalido}
                helperText={mostrarInvalido ? MENSAJE_UMBRAL_INVALIDO : 'Un producto con margen por debajo de este porcentaje se marca como «bajo».'}
                autoFocus
                slotProps={{
                  htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!umbral || nuevo === null || guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
