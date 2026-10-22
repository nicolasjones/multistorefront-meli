import type { ChangeEvent } from 'react'
import { Box, Button, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import {
  AYUDA_AJUSTE,
  BASES_REGLA,
  TEXTO_REDONDEO,
  type BaseRegla,
  type Cotizacion,
  formatearFechaCotizacion,
  formatearPesosPrecio,
} from '../../lib/precios'

type Props = {
  nombreEmpresa: string
  base: BaseRegla
  ajuste: string
  errorAjuste?: string
  onBase: (base: BaseRegla) => void
  onAjuste: (event: ChangeEvent<HTMLInputElement>) => void
  soloLectura: boolean
  cotizacion: Cotizacion | null
  cargandoCotizacion: boolean
  errorCotizacion: boolean
}

// Bloques «Precio de venta de <Empresa>» y «Moneda y cotización» de la pestaña «Precios y moneda»
// (F-PRE-07, FR-012; StorePrecios.dc.html). Es presentación pura: el estado y el guardado viven
// en la pantalla. «Precios que ve el cliente» (IVA) llega con F-PRE-12.
export function ReglaPrecioEmpresa({
  nombreEmpresa, base, ajuste, errorAjuste, onBase, onAjuste, soloLectura, cotizacion, cargandoCotizacion, errorCotizacion,
}: Props) {
  const fecha = cotizacion ? formatearFechaCotizacion(cotizacion.fecha) : ''
  let textoDolar: string
  if (errorCotizacion) textoDolar = 'No pudimos cargar la cotización. Recargá la página.'
  else if (cargandoCotizacion) textoDolar = 'Cargando la cotización…'
  else if (cotizacion) {
    textoDolar = `Dólar vigente ${formatearPesosPrecio(cotizacion.valor)}${fecha ? ` (${fecha})` : ''}. Los productos en USD se convierten con este valor.`
  } else textoDolar = 'Cargá la cotización: sin ella los productos en USD no tienen precio en pesos.'

  return (
    <Stack spacing={2}>
      <Box component="section" aria-labelledby="regla-precio-titulo" sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
        <Typography id="regla-precio-titulo" component="h2" variant="h6" sx={{ mb: 2 }}>
          Precio de venta de {nombreEmpresa}
        </Typography>
        <Stack spacing={2}>
          <Box>
            <Typography id="regla-base-etiqueta" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Base</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={base}
              aria-labelledby="regla-base-etiqueta"
              disabled={soloLectura}
              onChange={(_evento, valor: BaseRegla | null) => {
                if (valor) onBase(valor)
              }}
            >
              {BASES_REGLA.map((opcion) => (
                <ToggleButton key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          {base === 'central_ajuste' ? (
            <TextField
              label="Ajuste sobre el precio central"
              value={ajuste}
              onChange={onAjuste}
              error={Boolean(errorAjuste)}
              helperText={errorAjuste ?? AYUDA_AJUSTE}
              disabled={soloLectura}
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                htmlInput: { inputMode: 'decimal' },
              }}
              sx={{ maxWidth: 180 }}
            />
          ) : null}
          <TextField label="Redondeo" value={TEXTO_REDONDEO} disabled sx={{ maxWidth: 360 }} />
          <Typography variant="caption" color="text.secondary">
            Los productos con <b>precio propio</b> en esta empresa ignoran el ajuste. Se definen desde la ficha del producto.
          </Typography>
        </Stack>
      </Box>

      <Box component="section" aria-labelledby="moneda-cotizacion-titulo" sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
        <Typography id="moneda-cotizacion-titulo" component="h2" variant="h6" sx={{ mb: 2 }}>Moneda y cotización</Typography>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Moneda de la tienda" value="ARS · Peso argentino" disabled fullWidth />
            <TextField label="Cotización que usa" value="La general del sistema" disabled fullWidth />
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>{textoDolar}</Typography>
            {/* Sin destino hasta la carga del dólar (MSF-116); mismo criterio que el bloque «Precio y costo». */}
            <Button size="small" disabled aria-describedby="cotizacion-pendiente">Cotización →</Button>
            <Box id="cotizacion-pendiente" component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Disponible con la carga del dólar</Box>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  )
}
