import { Box, Typography } from '@mui/material'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import { rangoUnidades, type PreciosCliente as Precios } from '../../../lib/tiendaPreciosCliente'

// Precios del cliente con cuenta activa (F-CLI-07, FR-031/FR-032): el minorista ve su precio x1; el
// mayorista, el precio final de cada escala con su rango de unidades. Los montos ya vienen de la base.
export function PreciosCliente({ precios }: { precios: Precios }) {
  const mayorista = precios.tipo === 'mayorista'
  return (
    <Box component="section" aria-label="Tus precios" data-testid="precios-cliente" sx={{ mb: 2 }}>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {mayorista ? 'Tus precios por cantidad' : 'Tu precio'}
      </Typography>
      <Box component="dl" sx={{ m: 0 }}>
        {precios.escalas.map((e) => (
          <Box key={e.escala} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
            <Typography component="dt" color="text.secondary">
              {mayorista ? `${e.escala} · ${rangoUnidades(e)}` : 'Precio'}
            </Typography>
            <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>{formatearPrecioArs(e.final) ?? 'Consultar'}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
