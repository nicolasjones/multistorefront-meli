import { Box, Button, MenuItem, TextField, Typography } from '@mui/material'
import { type Alicuota, NOTA_OPCIONES_IVA, SIN_ALICUOTA_PRODUCTO, calcularFinal, formatearAlicuota } from '../../lib/iva'
import { formatearPesosPrecio } from '../../lib/precios'

type Props = {
  alicuotas: readonly Alicuota[]
  // Alícuota de la categoría del producto: la que rige si el producto no tiene una propia.
  alicuotaCategoria: Alicuota | null
  // Id de la alícuota propia; SIN_ALICUOTA_PRODUCTO = hereda la de su categoría.
  valor: string
  onCambiar: (alicuotaId: string) => void
  // Precio de lista sin IVA, en pesos; null si no hay un importe válido o el precio no está en pesos
  // (en dólares el final depende de la cotización y lo calcula el servidor).
  neto: number | null
  cargando: boolean
  hayError: boolean
  onReintentar: () => void
  soloLectura?: boolean
  deshabilitado?: boolean
}

// Campo «IVA» del producto (F-PRE-12, FR-021): hereda de la categoría o es propio, con el texto
// «Con IVA 21 %: $ … (IVA $ …)». La autoridad del precio final es la vista del servidor; acá solo el ejemplo.
export function IvaProducto({ alicuotas, alicuotaCategoria, valor, onCambiar, neto, cargando, hayError, onReintentar, soloLectura = false, deshabilitado = false }: Props) {
  const propia = alicuotas.find((alicuota) => alicuota.id === valor) ?? null
  const vigente = propia ?? alicuotaCategoria
  const textoHereda = alicuotaCategoria ? `Heredar de la categoría (${formatearAlicuota(alicuotaCategoria)})` : 'Heredar de la categoría'
  let ejemplo: string | null = null
  if (vigente && neto !== null) {
    const final = calcularFinal(neto, vigente)
    ejemplo = vigente.exento
      ? `Exento: ${formatearPesosPrecio(final)} (sin IVA)`
      : `Con IVA ${formatearAlicuota(vigente)}: ${formatearPesosPrecio(final)} (IVA ${formatearPesosPrecio(final - neto)})`
  }
  return (
    <Box>
      <TextField
        select
        fullWidth
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        label="IVA"
        value={valor}
        onChange={(event) => onCambiar(event.target.value)}
        disabled={soloLectura || deshabilitado || cargando}
        error={hayError}
        helperText={hayError ? 'No pudimos cargar las alícuotas de IVA.' : NOTA_OPCIONES_IVA}
      >
        <MenuItem value={SIN_ALICUOTA_PRODUCTO}>{textoHereda}</MenuItem>
        {alicuotas.map((alicuota) => (
          <MenuItem key={alicuota.id} value={alicuota.id}>{formatearAlicuota(alicuota)}</MenuItem>
        ))}
      </TextField>
      {hayError ? <Button size="small" onClick={onReintentar}>Reintentar IVA</Button> : null}
      {ejemplo ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{ejemplo}</Typography> : null}
    </Box>
  )
}
