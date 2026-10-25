import { MenuItem, TextField } from '@mui/material'
import { OPCIONES_ORDEN, type OrdenCatalogo } from '../../../lib/tiendaListado'

// «Ordenar por» (F-TDA-12, FR-035): Más relevantes / Menor precio / Mayor precio.
export function Ordenar({ orden, alCambiar }: { orden: OrdenCatalogo; alCambiar: (orden: OrdenCatalogo) => void }) {
  return (
    <TextField
      select
      size="small"
      label="Ordenar por"
      value={orden}
      onChange={(evento) => alCambiar(evento.target.value as OrdenCatalogo)}
      sx={{ minWidth: 200 }}
    >
      {OPCIONES_ORDEN.map((o) => <MenuItem key={o.valor} value={o.valor}>{o.etiqueta}</MenuItem>)}
    </TextField>
  )
}
