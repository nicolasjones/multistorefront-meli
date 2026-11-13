import { type FormEvent, useState } from 'react'
import { Alert, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, FormControlLabel, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useCargarCotizacion, useConfirmarCotizacion } from '../../hooks/useCotizacion'
import { usePrevisualizarImpactoDolar } from '../../hooks/usePrevisualizarImpactoDolar'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'
import { AlertaVariacionInusual } from './DialogoCargarDolar'
import {
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
  textoUmbralNoAlcanzado,
  variacionPorcentual,
} from '../../lib/cotizacion'

type Props = {
  abierto: boolean
  vigente: CotizacionVigente | null
  // Cotización APLICADA (la de los precios): contra ella se mide la variación.
  aplicada?: number | null
  onCerrar: () => void
  onConfirmada: (confirmada: CotizacionConfirmada) => void
  empresaId?: string | null
  nombreEmpresa?: string | null
  confirmacionPct?: number
}

// Diálogo «Cargar dólar del día» de Inicio (F-INI-07, MSF-823). A diferencia del de Cotización (cargar → vista
// previa → confirmar, que deja una cotización PENDIENTE antes de mostrar el impacto), acá el impacto se ve ANTES de
// guardar nada: mientras se tipea el valor se pide `previsualizar_impacto_dolar` (solo lectura). Cancelar o cerrar
// no escribe nada. Recién «Aplicar y recalcular» / «Registrar cotización» guarda (carga + confirma con las mismas
// RPC de siempre, con fecha y usuario) y avisa al dueño. Más de la variación configurada exige confirmarla
// explícitamente; menos del umbral solo registra. Sin Mercado Libre (no existe todavía). El dueño lo MONTA al abrir.
export function DialogoCargarDolarConImpacto({
  abierto, vigente, aplicada = null, onCerrar, onConfirmada, empresaId = null, nombreEmpresa = null, confirmacionPct = UMBRAL_VARIACION_INUSUAL_PCT,
}: Props) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revisado, setRevisado] = useState(false)
  const { cargar, enviando: cargando } = useCargarCotizacion()
  const { confirmar, descartar, enviando: resolviendo } = useConfirmarCotizacion()
  const ocupado = cargando || resolviendo

  const valor = parsearCotizacion(texto)
  const mostrarInvalido = texto.trim() !== '' && valor === null
  const { previa, cargando: calculando, hayError, recargar } = usePrevisualizarImpactoDolar(valor, empresaId)
  const base = aplicada ?? vigente?.valor ?? null
  // La base manda (variación y umbrales reales); mientras llega, la estimación local.
  const variacion = previa?.variacionPct ?? (valor !== null && base !== null ? variacionPorcentual(valor, base) : null)
  const umbralInusual = previa?.confirmacionPct ?? confirmacionPct
  const inusual = esVariacionInusual(variacion, umbralInusual)
  const puedeGuardar = valor !== null && previa !== null && !ocupado && (!inusual || revisado)

  const cambiarTexto = (nuevo: string) => {
    setTexto(soloCaracteresDeCotizacion(nuevo))
    setRevisado(false)
    setError(null)
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (valor === null || !previa || !puedeGuardar) return
    setError(null)
    const carga = await cargar(valor, empresaId)
    if (!carga.ok) {
      setError(carga.mensaje)
      return
    }
    const resultado = await confirmar(empresaId, variacion)
    if (!resultado.ok) {
      // No queda una pendiente suelta: si no se pudo confirmar, se descarta lo recién cargado.
      await descartar(empresaId)
      setError(resultado.mensaje)
      if (resultado.revisar) recargar()
      return
    }
    onConfirmada(resultado.confirmada)
  }

  return (
    <Dialog open={abierto} onClose={() => { if (!ocupado) onCerrar() }} fullWidth maxWidth="md" aria-labelledby="titulo-cargar-dolar-inicio">
      <form onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-cargar-dolar-inicio" onCerrar={() => { if (!ocupado) onCerrar() }}>Cargar dólar del día</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {nombreEmpresa ? <Typography variant="s">Cotización de {nombreEmpresa}</Typography> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Dólar del día (pesos por dólar)"
              value={texto}
              onChange={(evento) => cambiarTexto(evento.target.value)}
              error={mostrarInvalido}
              helperText={mostrarInvalido ? MENSAJE_VALOR_INVALIDO : (vigente ? textoAnterior(vigente, aplicada) : undefined)}
              autoFocus
              slotProps={{
                htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
                input: {
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  endAdornment: <InputAdornment position="end">por USD</InputAdornment>,
                },
              }}
            />
            {vigente ? <Typography variant="xs">Cotización vigente: {formatearCotizacion(aplicada ?? vigente.valor)} por USD</Typography> : null}
            <Stack direction="row" justifyContent="space-between" alignItems="center" role="status" aria-live="polite">
              <Typography variant="s">Variación contra la vigente</Typography>
              <Chip label={formatearVariacion(variacion)} size="small" color={inusual ? 'warning' : 'default'} />
            </Stack>
            {inusual ? <AlertaVariacionInusual confirmacionPct={umbralInusual} /> : null}
            {inusual ? (
              <FormControlLabel
                control={<Checkbox checked={revisado} onChange={(evento) => setRevisado(evento.target.checked)} />}
                label="Revisé el valor y quiero aplicarlo igual"
              />
            ) : null}
            {calculando ? <EstadoCargaPagina lineas={2} /> : null}
            {hayError ? <EstadoError descripcion="No pudimos calcular qué va a cambiar." reintentar={recargar} /> : null}
            {previa && !previa.recalcula ? (
              <Alert severity="info">
                <Typography component="p" fontWeight={600}>Sin recálculo</Typography>
                {textoUmbralNoAlcanzado(previa.umbralPct ?? UMBRAL_RECALCULO_PCT)}
              </Alert>
            ) : null}
            {previa?.recalcula ? <BloqueQueVaACambiar previa={previa} /> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={ocupado}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!puedeGuardar}>
            {ocupado ? 'Guardando…' : previa && !previa.recalcula ? 'Registrar cotización' : 'Aplicar y recalcular'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
