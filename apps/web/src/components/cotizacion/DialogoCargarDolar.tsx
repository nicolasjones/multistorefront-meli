import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { useCargarCotizacion } from '../../hooks/useCotizacion'
import {
  type CotizacionCargada,
  type CotizacionVigente,
  MENSAJE_VALOR_INVALIDO,
  UMBRAL_VARIACION_INUSUAL_PCT,
  esVariacionInusual,
  formatearVariacion,
  parsearCotizacion,
  soloCaracteresDeCotizacion,
  textoAnterior,
  variacionPorcentual,
} from '../../lib/cotizacion'

type Props = {
  abierto: boolean
  vigente: CotizacionVigente | null
  onCerrar: () => void
  onCargada: (carga: CotizacionCargada) => void
}

// Diálogo «Cargar dólar del día» (F-PRE-02, FR-006/FR-007; Cotizacion.dc.html): valor con `$` y
// `por USD`, «Anterior», «Variación» y la alerta «Variación inusual» (> 15 %, solo aviso). Al
// confirmar un valor válido queda como cotización PENDIENTE; no cambia ningún precio. La vista
// previa y la confirmación son de F-PRE-03. La validación real es la de la base.
export function DialogoCargarDolar({ abierto, vigente, onCerrar, onCargada }: Props) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { cargar, enviando } = useCargarCotizacion()

  useEffect(() => {
    if (!abierto) return
    setTexto('')
    setError(null)
  }, [abierto])

  const valor = parsearCotizacion(texto)
  const invalido = valor === null
  const variacion = valor !== null && vigente ? variacionPorcentual(valor, vigente.valor) : null
  const mostrarInvalido = texto.trim() !== '' && invalido

  const cerrar = () => {
    if (enviando) return
    onCerrar()
  }

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (valor === null || enviando) return
    setError(null)
    const resultado = await cargar(valor)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    onCargada(resultado.carga)
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-cargar-dolar">
      <form onSubmit={(evento) => void confirmar(evento)} noValidate>
        <TituloDialogo id="titulo-cargar-dolar" onCerrar={cerrar}>Cargar dólar del día</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Dólar del día (pesos por dólar)"
              value={texto}
              onChange={(evento) => setTexto(soloCaracteresDeCotizacion(evento.target.value))}
              error={mostrarInvalido}
              helperText={mostrarInvalido ? MENSAJE_VALOR_INVALIDO : (vigente ? textoAnterior(vigente) : undefined)}
              autoFocus
              slotProps={{
                htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
                input: {
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  endAdornment: <InputAdornment position="end">por USD</InputAdornment>,
                },
              }}
            />
            {mostrarInvalido && vigente ? <Typography variant="s">{textoAnterior(vigente)}</Typography> : null}
            <Stack direction="row" justifyContent="space-between" role="status" aria-live="polite">
              <Typography variant="s">Variación</Typography>
              <Typography variant="b" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatearVariacion(variacion)}</Typography>
            </Stack>
            {esVariacionInusual(variacion) ? (
              <Alert severity="warning">
                <Typography component="p" fontWeight={600}>Variación inusual</Typography>
                La variación supera el {UMBRAL_VARIACION_INUSUAL_PCT} %. Revisá que el valor sea correcto antes de aplicarlo.
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={invalido || enviando}>
            {enviando ? 'Cargando…' : 'Cargar dólar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
