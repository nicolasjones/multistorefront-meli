import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useCargarCotizacion, useConfirmarCotizacion } from '../../hooks/useCotizacion'
import { usePrevisualizarCotizacion } from '../../hooks/usePrevisualizarCotizacion'
import { type EstadoSugerida, useCotizacionSugerida } from '../../hooks/useCotizacionSugerida'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'
import {
  type CotizacionCargada,
  type CotizacionConfirmada,
  type CotizacionVigente,
  MENSAJE_VALOR_INVALIDO,
  UMBRAL_RECALCULO_PCT,
  UMBRAL_VARIACION_INUSUAL_PCT,
  esVariacionInusual,
  formatearPorcentaje,
  formatearCotizacion,
  formatearVariacion,
  parsearCotizacion,
  soloCaracteresDeCotizacion,
  textoDeCotizacionSugerida,
  textoAnterior,
  textoUmbralNoAlcanzado,
  variacionPorcentual,
} from '../../lib/cotizacion'

type Props = {
  abierto: boolean
  vigente: CotizacionVigente | null
  // Cotización APLICADA (la de los precios): contra ella se mide la variación. Sin dato rige la última carga (`vigente`).
  aplicada?: number | null
  onCerrar: () => void
  onConfirmada: (confirmada: CotizacionConfirmada) => void
  // F-PRE-06: con alcance «una por empresa» la carga es de esta empresa; la variación inusual es la configurada.
  empresaId?: string | null
  nombreEmpresa?: string | null
  confirmacionPct?: number
}

function AlertaVariacionInusual({ confirmacionPct }: { confirmacionPct: number }) {
  return (
    <Alert severity="warning">
      <Typography component="p" fontWeight={600}>Variación inusual</Typography>
      La variación supera el {formatearPorcentaje(confirmacionPct)} %. Revisá que el valor sea correcto antes de aplicarlo.
    </Alert>
  )
}

// F-PRE-13: la cotización sugerida por la fuente pública es una AYUDA; «Usar este valor» solo completa el campo
// (la carga y la confirmación son las de siempre). Si la fuente no responde, se carga a mano como hoy (FR-002).
function SugerenciaDelDia({ sugerencia, onUsar }: { sugerencia: EstadoSugerida; onUsar: (valor: number) => void }) {
  if (sugerencia.estado === 'cargando') return <Typography variant="xs">Buscando la cotización sugerida…</Typography>
  if (sugerencia.estado === 'no_disponible') return <Typography variant="xs">No pudimos consultar la cotización sugerida. Cargá el valor a mano.</Typography>
  const { valor, fuente, fecha } = sugerencia.sugerida
  const actualizada = fecha ? new Date(fecha).toLocaleDateString('es-AR') : null
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="xs">Sugerida: {formatearCotizacion(valor)} por USD · {fuente}{actualizada ? ` · actualizada el ${actualizada}` : ''}</Typography>
      <Button size="small" onClick={() => onUsar(valor)}>Usar este valor</Button>
    </Stack>
  )
}

// Diálogo «Cargar dólar del día» (F-PRE-02 FR-006/FR-007 y F-PRE-03 FR-014/FR-015; Cotizacion.dc.html).
// Paso 1: el valor con `$` y `por USD`, «Anterior», «Variación» y la alerta «Variación inusual»; al
// continuar queda como cotización PENDIENTE y no cambia ningún precio. Paso 2: vista previa «Qué va a
// cambiar» y la decisión: «Aplicar y recalcular» / «Registrar cotización» (bajo el umbral de 1 %) o
// «Cancelar», que descarta la pendiente. La validación y el umbral reales son los de la base; los textos
// muestran los valores configurados (F-PRE-06). El dueño lo MONTA al abrir (y lo desmonta al cerrar): cada
// apertura empieza con el campo vacío.
export function DialogoCargarDolar({
  abierto, vigente, aplicada = null, onCerrar, onConfirmada, empresaId = null, nombreEmpresa = null, confirmacionPct = UMBRAL_VARIACION_INUSUAL_PCT,
}: Props) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [carga, setCarga] = useState<CotizacionCargada | null>(null)
  const { cargar, enviando: cargando } = useCargarCotizacion()
  const { confirmar, descartar, enviando: resolviendo } = useConfirmarCotizacion()
  const ocupado = cargando || resolviendo
  const sugerencia = useCotizacionSugerida(abierto && !carga)
  // Sube cuando la base rechaza porque el dólar cambió mientras se revisaba: el paso 2 recalcula la vista previa.
  const [revision, setRevision] = useState(0)

  const valor = parsearCotizacion(texto)
  const invalido = valor === null
  const base = aplicada ?? vigente?.valor ?? null
  const variacion = valor !== null && base !== null ? variacionPorcentual(valor, base) : null
  const mostrarInvalido = texto.trim() !== '' && invalido

  // Con una pendiente cargada, cerrar equivale a «Cancelar»: se descarta (si falla, el diálogo sigue abierto).
  const cerrar = async () => {
    if (ocupado) return
    if (carga) {
      const resultado = await descartar(empresaId)
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
    const resultado = await cargar(valor, empresaId)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    setCarga(resultado.carga)
  }

  // El llamador avisa según lo que decidió la base (puede diferir de la vista previa si el dólar cambió).
  // `variacionVista`: la variación del aviso de variación inusual que estaba a la vista al apretar «Aplicar» (null sin aviso);
  // la base la compara con la real y rechaza si el dólar cambió mientras se revisaba.
  const confirmarValor = async (variacionVista: number | null) => {
    if (ocupado) return
    setError(null)
    const resultado = await confirmar(empresaId, variacionVista)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      if (resultado.revisar) setRevision((n) => n + 1)
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
          aplicada={aplicada}
          empresaId={empresaId}
          nombreEmpresa={nombreEmpresa}
          confirmacionPct={confirmacionPct}
          error={error}
          ocupado={ocupado}
          onCancelar={() => void cerrar()}
          onConfirmar={(variacionVista) => void confirmarValor(variacionVista)}
          revision={revision}
        />
      ) : (
        <form onSubmit={(evento) => void cargarValor(evento)} noValidate>
          <TituloDialogo id="titulo-cargar-dolar" onCerrar={() => void cerrar()}>Cargar dólar del día</TituloDialogo>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {nombreEmpresa ? <Typography variant="s">Cotización de {nombreEmpresa}</Typography> : null}
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                label="Dólar del día (pesos por dólar)"
                value={texto}
                onChange={(evento) => setTexto(soloCaracteresDeCotizacion(evento.target.value))}
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
              <SugerenciaDelDia sugerencia={sugerencia} onUsar={(sugerido) => setTexto(textoDeCotizacionSugerida(sugerido))} />
              {mostrarInvalido && vigente ? <Typography variant="s">{textoAnterior(vigente, aplicada)}</Typography> : null}
              <Stack direction="row" justifyContent="space-between" role="status" aria-live="polite">
                <Typography variant="s">Variación</Typography>
                <Typography variant="b" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatearVariacion(variacion)}</Typography>
              </Stack>
              {esVariacionInusual(variacion, confirmacionPct) ? <AlertaVariacionInusual confirmacionPct={confirmacionPct} /> : null}
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
  empresaId: string | null
  nombreEmpresa: string | null
  confirmacionPct: number
  error: string | null
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: (variacionVista: number | null) => void
  revision?: number
  aplicada?: number | null
}

// Paso 2: la cotización ya está pendiente; se ve qué cambiaría y se decide (F-PRE-03).
function PasoConfirmar({ carga, vigente, aplicada = null, revision = 0, empresaId, nombreEmpresa, confirmacionPct, error, ocupado, onCancelar, onConfirmar }: PasoConfirmarProps) {
  const { previa, cargando, hayError, recargar } = usePrevisualizarCotizacion(empresaId)
  const variacion = previa?.variacionPct ?? carga.variacionPct
  // El umbral de la base manda sobre la prop (que puede estar vieja si alguien lo cambió): evita rechazos en bucle.
  const confirmacionVigente = previa?.confirmacionPct ?? confirmacionPct
  const ultimaRevision = useRef(revision)
  useEffect(() => {
    if (revision === ultimaRevision.current) return
    ultimaRevision.current = revision
    void recargar()
  }, [revision, recargar])

  return (
    <>
      <TituloDialogo id="titulo-cargar-dolar" onCerrar={onCancelar}>Cargar dólar del día</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {nombreEmpresa ? <Typography variant="s">Cotización de {nombreEmpresa}</Typography> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={2}>
            <Stack>
              <Typography variant="s">Dólar del día (pesos por dólar)</Typography>
              <Typography variant="t2" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatearCotizacion(carga.valor)} <Typography component="span" variant="s">por USD</Typography>
              </Typography>
              {vigente ? <Typography variant="xs">{textoAnterior(vigente, aplicada)}</Typography> : null}
            </Stack>
            <Stack role="status" aria-live="polite" sx={{ alignItems: 'flex-end' }}>
              <Typography variant="xs">Variación</Typography>
              <Typography variant="b" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatearVariacion(variacion)}</Typography>
            </Stack>
          </Stack>
          {esVariacionInusual(variacion, confirmacionVigente) ? <AlertaVariacionInusual confirmacionPct={confirmacionVigente} /> : null}
          {cargando ? <EstadoCargaPagina lineas={2} /> : null}
          {hayError ? <EstadoError descripcion="No pudimos calcular qué va a cambiar." reintentar={() => void recargar()} /> : null}
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
        <Button onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
        <Button variant="contained" disabled={!previa || ocupado} // Con vista previa se manda SIEMPRE la variación que se ve (la base la ignora si no es inusual): así un umbral desfasado
          // en pantalla no entra en un bucle de rechazos.
          onClick={() => onConfirmar(previa ? variacion : null)}>
          {previa && !previa.recalcula ? 'Registrar cotización' : 'Aplicar y recalcular'}
        </Button>
      </DialogActions>
    </>
  )
}
