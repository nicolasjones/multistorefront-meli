import type { ChangeEvent, Ref } from 'react'
import { Box, Stack, TextField, Typography } from '@mui/material'
import type { Moneda } from '../../lib/productos'
import { formatearMargen } from '../../lib/precios'
import {
  ESCALAS,
  type ErroresEscala,
  type EscalaConPrecio,
  type PreciosEscala,
  TEXTO_USO_ESCALAS,
  margenDeEscala,
  rotuloEscala,
} from '../../lib/escalas'

type Props = {
  moneda: Moneda
  // x1 es el precio de lista: se edita en «Precio y costo» y acá solo se muestra.
  precioLista: string
  costo: string
  valores: PreciosEscala
  errores: ErroresEscala
  onCambiar: (escala: EscalaConPrecio, valor: string) => void
  refEscala?: (escala: EscalaConPrecio) => Ref<HTMLInputElement>
  // El margen sale del costo: solo con la sección `rentabilidad` (sin ella el costo no llega al navegador).
  conMargen: boolean
  cotizacion: number | null
  soloLectura: boolean
  deshabilitado?: boolean
}

// Bloque «Precios por escala · sin IVA» del formulario de producto (F-PRE-15, FR-026). Las cuatro
// escalas del prototipo con el margen de cada una. La conversión y el margen son una vista previa:
// la autoridad es la base (`private.precio_para`). Una escala vacía cae en el precio de lista.
export function EscalasPrecio({
  moneda, precioLista, costo, valores, errores, onCambiar, refEscala, conMargen, cotizacion, soloLectura, deshabilitado = false,
}: Props) {
  return (
    <Stack spacing={1.5} component="section" aria-label="Precios por escala">
      <Box>
        <Typography variant="subtitle2" component="h3">Precios por escala · sin IVA</Typography>
        <Typography variant="caption" color="text.secondary">{TEXTO_USO_ESCALAS}</Typography>
      </Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {ESCALAS.map(({ valor: escala, uso }) => {
          const conPrecio = escala !== 'x1'
          const error = conPrecio ? errores[escala] : undefined
          const margen = conMargen ? `Margen ${formatearMargen(margenDeEscala({ moneda, precioLista, costo }, escala, valores, cotizacion))} · ${uso}` : uso
          const ayuda = error ?? (conPrecio && valores[escala].trim() === '' ? `${margen} · usa el precio de lista` : margen)
          return (
            <TextField
              key={escala}
              label={`${rotuloEscala(escala)} (${moneda})`}
              value={conPrecio ? valores[escala] : precioLista}
              onChange={conPrecio ? (event: ChangeEvent<HTMLInputElement>) => onCambiar(escala, event.target.value) : undefined}
              error={Boolean(error)}
              helperText={ayuda}
              inputRef={conPrecio ? refEscala?.(escala) : undefined}
              autoComplete="off"
              fullWidth
              disabled={!conPrecio || soloLectura || deshabilitado}
              slotProps={{ htmlInput: { inputMode: 'decimal' }, inputLabel: { shrink: true } }}
            />
          )
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        x1 es el precio de lista. Una escala sin precio usa el de lista.
      </Typography>
    </Stack>
  )
}
