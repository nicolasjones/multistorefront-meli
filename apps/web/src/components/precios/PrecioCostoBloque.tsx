import type { ChangeEvent, Ref } from 'react'
import { Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { MONEDAS, type Moneda } from '../../lib/productos'
import {
  AVISO_CARGAR_COTIZACION,
  NOTA_SIN_IVA,
  type Cotizacion,
  formatearFechaCotizacion,
  formatearPesosPrecio,
  resumirPrecios,
} from '../../lib/precios'
import { MargenEstimado } from './MargenEstimado'

type Props = {
  moneda: Moneda
  precioLista: string
  costo: string
  errorPrecio?: string
  errorCosto?: string
  onMoneda: (moneda: Moneda) => void
  onPrecio: (event: ChangeEvent<HTMLInputElement>) => void
  onCosto: (event: ChangeEvent<HTMLInputElement>) => void
  refPrecio?: Ref<HTMLInputElement>
  refCosto?: Ref<HTMLInputElement>
  // Costo y margen solo con la sección `rentabilidad`; se edita solo con edición.
  conCosto: boolean
  costoEditable: boolean
  soloLectura: boolean
  cotizacion: Cotizacion | null
  cargandoCotizacion: boolean
  errorCotizacion: boolean
  ayudaCosto?: string
}

// Bloque «Precio y costo» del formulario de producto (F-PRE-01, FR-005/FR-006). La conversión
// que se muestra es una vista previa: la autoridad es la base (`productos_precio_costo`).
export function PrecioCostoBloque({
  moneda, precioLista, costo, errorPrecio, errorCosto, onMoneda, onPrecio, onCosto, refPrecio, refCosto,
  conCosto, costoEditable, soloLectura, cotizacion, cargandoCotizacion, errorCotizacion, ayudaCosto,
}: Props) {
  const valorDolar = cotizacion?.valor ?? null
  const resumen = resumirPrecios({ moneda, precioLista, costo }, valorDolar)
  const faltaCotizacion = moneda === 'USD' && !cargandoCotizacion && valorDolar === null
  const fecha = cotizacion ? formatearFechaCotizacion(cotizacion.fecha) : ''

  let ayudaPesos: string
  if (errorCotizacion) ayudaPesos = 'No pudimos cargar la cotización. Recargá la página.'
  else if (faltaCotizacion) ayudaPesos = AVISO_CARGAR_COTIZACION
  else if (moneda === 'USD' && valorDolar !== null) ayudaPesos = `Con dólar ${formatearPesosPrecio(valorDolar)}${fecha ? ` (${fecha})` : ''}.`
  else ayudaPesos = 'El precio ya está en pesos.'

  const hintCosto =
    conCosto && moneda === 'USD' && resumen.costoArs !== null && valorDolar !== null
      ? `costo ${formatearPesosPrecio(resumen.costoArs)} · con dólar ${formatearPesosPrecio(valorDolar)}${fecha ? ` (${fecha})` : ''}`
      : null

  return (
    <Stack spacing={2} component="section" aria-label="Precio y costo">
      <Typography variant="subtitle2" component="h3">Precio y costo</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Moneda"
          value={moneda}
          onChange={(event) => onMoneda(event.target.value as Moneda)}
          disabled={soloLectura}
          fullWidth
        >
          {MONEDAS.map(({ valor, etiqueta }) => (
            <MenuItem key={valor} value={valor}>{etiqueta}</MenuItem>
          ))}
        </TextField>
        <TextField
          label="Precio de lista (sin IVA)"
          value={precioLista}
          onChange={onPrecio}
          error={Boolean(errorPrecio)}
          helperText={errorPrecio ?? NOTA_SIN_IVA}
          inputRef={refPrecio}
          required
          autoComplete="off"
          fullWidth
          disabled={soloLectura}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
      </Stack>
      <TextField
        label="Precio en pesos"
        value={resumen.precioArs !== null ? formatearPesosPrecio(resumen.precioArs) : '—'}
        disabled
        error={faltaCotizacion}
        helperText={ayudaPesos}
        fullWidth
      />
      {conCosto ? (
        <TextField
          label="Costo"
          value={costo}
          onChange={onCosto}
          error={Boolean(errorCosto)}
          helperText={errorCosto ?? (costoEditable && !soloLectura ? ayudaCosto : undefined)}
          inputRef={refCosto}
          autoComplete="off"
          fullWidth
          disabled={soloLectura || !costoEditable}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
      ) : null}
      {hintCosto !== null ? <Typography variant="caption" color="text.secondary">{hintCosto}</Typography> : null}
      {conCosto ? <MargenEstimado margen={resumen.margen} /> : null}
      <Box>
        <Button size="small" disabled aria-label="Cotización (disponible con la carga del dólar)">Cotización →</Button>
      </Box>
    </Stack>
  )
}
