import { type FormEvent, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useCargarCotizacion, useConfirmarCotizacion } from '../../hooks/useCotizacion'
import { usePrevisualizarCotizacion } from '../../hooks/usePrevisualizarCotizacion'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'
import {
  type CotizacionCargada,
  type CotizacionConfirmada,
  type CotizacionVigente,
  MENSAJE_VALOR_INVALIDO,
  UMBRAL_RECALCULO_PCT,
  UMBRAL_VARIACION_INUSUAL_PCT,
  esVariacionInusual,
  formatearCotizacion,
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
  onConfirmada: (confirmada: CotizacionConfirmada) => void
}

function AlertaVariacionInusual() {
  return (
    <Alert severity="warning">
      <Typography component="p" fontWeight={600}>Variación inusual</Typography>
      La variación supera el {UMBRAL_VARIACION_INUSUAL_PCT} %. Revisá que el valor sea correcto antes de aplicarlo.
    </Alert>
  )
}

// Diálogo «Cargar dólar del día» (F-PRE-02 FR-006/FR-007 y F-PRE-03 FR-014/FR-015; Cotizacion.dc.html).
// Paso 1: el valor con `$` y `por USD`, «Anterior», «Variación» y la alerta «Variación inusual»; al
// continuar queda como cotización PENDIENTE y no cambia ningún precio. Paso 2: vista previa «Qué va a
// cambiar» y la decisión: «Aplicar y recalcular» / «Registrar cotización» (bajo el umbral de 1 %) o
// «Cancelar», que descarta la pendiente. La validación y el umbral reales son los de la base. El dueño
// lo MONTA al abrir (y lo desmonta al cerrar): cada apertura empieza con el campo vacío.
export function DialogoCargarDolar({ abierto, vigente, onCerrar, onConfirmada }: Props) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [carga, setCarga] = useState<CotizacionCargada | null>(null)
  const { cargar, enviando: cargando } = useCargarCotizacion()
  const { confirmar, descartar, enviando: resolviendo } = useConfirmarCotizacion()
  const ocupado = cargando || resolviendo

  const valor = parsearCotizacion(texto)
  const invalido = valor === null
  const variacion = valor !== null && vigente ? variacionPorcentual(valor, vigente.valor) : null
  const mostrarInvalido = texto.trim() !== '' && invalido

  // Con una pendiente cargada, cerrar equivale a «Cancelar»: se descarta (si falla, el diálogo sigue abierto).
  const cerrar = async () => {
    if (ocupado) return
    if (carga) {
      const resultado = await descartar()
      if (!resultado.ok) {
        setError(resultado.mensaje)
        return
      }
    }
    onCerrar()
  }

  const cargarValor = async (evento: FormEvent) => {
    evento.preventDefault()
    if (valor === null || ocupado) return
    setError(null)
    const resultado = await cargar(valor)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    setCarga(resultado.carga)
  }

  // El llamador avisa según lo que decidió la base (puede diferir de la vista previa si el dólar cambió).
  const confirmarValor = async () => {
    if (ocupado) return
    setError(null)
    const resultado = await confirmar()
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    onConfirmada(resultado.confirmada)
  }

  return (
    <Dialog open={abierto} onClose={() => void cerrar()} fullWidth maxWidth={carga ? 'md' : 'xs'} aria-labelledby="titulo-cargar-dolar">
      {carga ? (
        <PasoConfirmar
          carga={carga}
          vigente={vigente}
          error={error}
          ocupado={ocupado}
          onCancelar={() => void cerrar()}
          onConfirmar={() => void confirmarValor()}
        />
      ) : (
        <form onSubmit={(evento) => void cargarValor(evento)} noValidate>
          <TituloDialogo id="titulo-cargar-dolar" onCerrar={() => void cerrar()}>Cargar dólar del día</TituloDialogo>
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
              {esVariacionInusual(variacion) ? <AlertaVariacionInusual /> : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => void cerrar()} disabled={ocupado}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={invalido || ocupado}>
              {cargando ? 'Cargando…' : 'Cargar dólar'}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}

type PasoConfirmarProps = {
  carga: CotizacionCargada
  vigente: CotizacionVigente | null
  error: string | null
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: () => void
}

// Paso 2: la cotización ya está pendiente; se ve qué cambiaría y se decide (F-PRE-03).
function PasoConfirmar({ carga, vigente, error, ocupado, onCancelar, onConfirmar }: PasoConfirmarProps) {
  const { previa, cargando, hayError, recargar } = usePrevisualizarCotizacion()
  const variacion = previa?.variacionPct ?? carga.variacionPct

  return (
    <>
      <TituloDialogo id="titulo-cargar-dolar" onCerrar={onCancelar}>Cargar dólar del día</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={2}>
            <Stack>
              <Typography variant="s">Dólar del día (pesos por dólar)</Typography>
              <Typography variant="t2" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatearCotizacion(carga.valor)} <Typography component="span" variant="s">por USD</Typography>
              </Typography>
              {vigente ? <Typography variant="xs">{textoAnterior(vigente)}</Typography> : null}
            </Stack>
            <Stack role="status" aria-live="polite" sx={{ alignItems: 'flex-end' }}>
              <Typography variant="xs">Variación</Typography>
              <Typography variant="b" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatearVariacion(variacion)}</Typography>
            </Stack>
          </Stack>
          {esVariacionInusual(variacion) ? <AlertaVariacionInusual /> : null}
          {cargando ? <EstadoCargaPagina lineas={2} /> : null}
          {hayError ? <EstadoError descripcion="No pudimos calcular qué va a cambiar." reintentar={() => void recargar()} /> : null}
          {previa && !previa.recalcula ? (
            <Alert severity="info">
              <Typography component="p" fontWeight={600}>Sin recálculo</Typography>
              La variación es menor al umbral de {UMBRAL_RECALCULO_PCT} %: la cotización queda registrada, pero no se recalculan precios.
            </Alert>
          ) : null}
          {previa?.recalcula ? <BloqueQueVaACambiar previa={previa} /> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
        <Button variant="contained" disabled={!previa || ocupado} onClick={onConfirmar}>
          {previa && !previa.recalcula ? 'Registrar cotización' : 'Aplicar y recalcular'}
        </Button>
      </DialogActions>
    </>
  )
}
