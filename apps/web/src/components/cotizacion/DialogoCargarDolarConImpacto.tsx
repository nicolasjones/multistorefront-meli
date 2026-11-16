import { type FormEvent, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useAplicarCotizacion } from '../../hooks/useCotizacion'
import { usePrevisualizarImpactoDolar } from '../../hooks/usePrevisualizarImpactoDolar'
import { AlertaVariacionInusual } from './AlertaVariacionInusual'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'
import { CampoDolar } from './CampoDolar'
import {
  type CotizacionConfirmada,
  type CotizacionVigente,
  UMBRAL_RECALCULO_PCT,
  UMBRAL_VARIACION_INUSUAL_PCT,
  esVariacionInusual,
  formatearCotizacion,
  formatearVariacion,
  parsearCotizacion,
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
  // Ya hay una cotización confirmada hoy: el diálogo sirve para corregirla y lo indica (reemplaza la de hoy).
  yaCargadaHoy?: boolean
}

// Un valor que se aleja más de este factor de la cotización vigente (hacia arriba o hacia abajo) es casi seguro un
// error de tipeo (o un valor a medio escribir: «1», «14», «149»…): no se pide la vista previa (cada pausa al tipear
// es una llamada a la base) y no se puede aplicar; se pide revisar el valor.
const FACTOR_MAXIMO_VS_VIGENTE = 10

// Diálogo «Cargar dólar del día» de Inicio (F-INI-07, MSF-823). A diferencia del de Cotización (cargar → vista
// previa → confirmar, que deja una cotización PENDIENTE antes de mostrar el impacto), acá el impacto se ve ANTES de
// guardar nada: mientras se tipea el valor se pide `previsualizar_impacto_dolar` (solo lectura). Cancelar o cerrar
// no escribe nada. Recién «Aplicar y recalcular» / «Registrar cotización» guarda, con UNA llamada atómica
// (`aplicar_cotizacion`: carga + confirma en una transacción, con fecha y usuario): si algo falla no queda ninguna
// cotización pendiente. Más de la variación configurada exige confirmarla explícitamente; menos del umbral solo
// registra. Sin Mercado Libre (no existe todavía). El dueño lo MONTA al abrir.
export function DialogoCargarDolarConImpacto({
  abierto, vigente, aplicada = null, onCerrar, onConfirmada, empresaId = null, nombreEmpresa = null,
  confirmacionPct = UMBRAL_VARIACION_INUSUAL_PCT, yaCargadaHoy = false,
}: Props) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revisado, setRevisado] = useState(false)
  const { aplicar, enviando: ocupado } = useAplicarCotizacion()
  // Guarda síncrona contra el doble clic: `ocupado` recién cambia en el render siguiente.
  const aplicando = useRef(false)

  const valor = parsearCotizacion(texto)
  const mostrarInvalido = texto.trim() !== '' && valor === null
  const base = aplicada ?? vigente?.valor ?? null
  const absurdo = valor !== null && base !== null && base > 0 && (valor > base * FACTOR_MAXIMO_VS_VIGENTE || valor < base / FACTOR_MAXIMO_VS_VIGENTE)
  const valorAPedir = absurdo ? null : valor
  const { previa, anterior, cargando: calculando, hayError, recargar } = usePrevisualizarImpactoDolar(valorAPedir, empresaId)
  // La base manda (variación y umbrales reales); mientras llega, la estimación local.
  const variacion = previa?.variacionPct ?? (valor !== null && base !== null ? variacionPorcentual(valor, base) : null)
  const umbralInusual = previa?.confirmacionPct ?? confirmacionPct
  const inusual = esVariacionInusual(variacion, umbralInusual)
  const puedeGuardar = valor !== null && !absurdo && previa !== null && !ocupado && (!inusual || revisado)
  // Lo que se ve de impacto: el actual o, mientras llega el nuevo, el anterior atenuado (sin parpadeo del esqueleto).
  const mostrada = previa ?? (calculando ? anterior : null)

  const cambiarTexto = (nuevo: string) => {
    setTexto(nuevo)
    setRevisado(false)
    setError(null)
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (valor === null || !previa || !puedeGuardar || aplicando.current) return
    aplicando.current = true
    setError(null)
    try {
      const resultado = await aplicar(valor, empresaId, variacion)
      if (!resultado.ok) {
        setError(resultado.mensaje)
        // La variación real ya no es la que se revisó: hay que volver a revisarla (el tilde no se hereda).
        if (resultado.revisar) {
          setRevisado(false)
          recargar()
        }
        return
      }
      onConfirmada(resultado.confirmada)
    } finally {
      aplicando.current = false
    }
  }

  return (
    <Dialog open={abierto} onClose={() => { if (!ocupado) onCerrar() }} fullWidth maxWidth="md" aria-labelledby="titulo-cargar-dolar-inicio">
      <form onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-cargar-dolar-inicio" onCerrar={() => { if (!ocupado) onCerrar() }}>Cargar dólar del día</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {nombreEmpresa ? <Typography variant="s">Cotización de {nombreEmpresa}</Typography> : null}
            {yaCargadaHoy ? <Alert severity="info">Ya se cargó hoy: esto reemplaza la cotización.</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            <CampoDolar
              texto={texto}
              onCambiar={cambiarTexto}
              invalido={mostrarInvalido}
              ayuda={vigente ? textoAnterior(vigente, aplicada) : undefined}
            />
            {vigente ? <Typography variant="xs">Cotización vigente: {formatearCotizacion(aplicada ?? vigente.valor)} por USD</Typography> : null}
            {absurdo ? (
              <Alert severity="warning">
                El valor se aleja más de {FACTOR_MAXIMO_VS_VIGENTE} veces de la cotización vigente. Revisalo: puede ser un error de tipeo.
              </Alert>
            ) : null}
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
            <Box aria-live="polite" aria-busy={calculando} sx={{ opacity: calculando && mostrada ? 0.5 : 1, transition: 'opacity 150ms' }}>
              {calculando && !mostrada ? <EstadoCargaPagina lineas={2} /> : null}
              {hayError ? <EstadoError descripcion="No pudimos calcular qué va a cambiar." reintentar={recargar} /> : null}
              {mostrada && !mostrada.recalcula ? (
                <Alert severity="info">
                  <Typography component="p" fontWeight={600}>Sin recálculo</Typography>
                  {textoUmbralNoAlcanzado(mostrada.umbralPct ?? UMBRAL_RECALCULO_PCT)}
                </Alert>
              ) : null}
              {mostrada?.recalcula ? <BloqueQueVaACambiar previa={mostrada} /> : null}
            </Box>
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
