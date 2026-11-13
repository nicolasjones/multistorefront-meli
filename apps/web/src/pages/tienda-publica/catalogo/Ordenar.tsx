import { Box, MenuItem, Select, Typography } from '@mui/material'
import { OPCIONES_ORDEN, type OrdenCatalogo } from '../../../lib/tiendaListado'
import { BORDE_PANEL } from '../layout/medidas'

// Flecha «▾» del botón: definida fuera del componente (un componente nuevo por render remontaría el ícono).
function FlechaOrden() {
  return <Box component="span" aria-hidden sx={{ position: 'absolute', right: '14px', pointerEvents: 'none' /* estilos-sueltos: ok */ }}>▾</Box>
}

// «Ordenar por» (F-TDA-12, FR-035; prototipo `MJC_Catalogo`): la etiqueta en gris a la izquierda y, al lado, el botón con la
// opción actual y «▾» (borde de 1,5 px, radio 6). Su menú es una lista de 200 px con radio 10, borde y sombra suaves, y la
// opción vigente en negrita y color primario. Más relevantes / Menor precio / Mayor precio.
export function Ordenar({ orden, alCambiar }: { orden: OrdenCatalogo; alCambiar: (orden: OrdenCatalogo) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 15 /* estilos-sueltos: ok */ }}>
      <Typography component="label" id="ordenar-por-etiqueta" htmlFor="ordenar-por" sx={{ color: 'text.secondary', fontSize: 'inherit' }}>Ordenar por</Typography>
      <Select
        size="small"
        id="ordenar-por"
        labelId="ordenar-por-etiqueta"
        value={orden}
        onChange={(evento) => alCambiar(evento.target.value as OrdenCatalogo)}
        IconComponent={FlechaOrden}
        sx={{
          fontSize: 15, bgcolor: 'background.paper', // estilos-sueltos: ok
          '& .MuiSelect-select': { py: '8px', pl: '14px', pr: '28px !important', minHeight: 'unset', height: 'auto' }, // estilos-sueltos: ok
          '& fieldset': { borderWidth: '1.5px', borderColor: 'rgba(0,0,0,.18)', borderRadius: '6px' }, // estilos-sueltos: ok
        }}
        MenuProps={{
          anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
          transformOrigin: { vertical: 'top', horizontal: 'right' },
          slotProps: { paper: { sx: { width: 200, mt: '4px', borderRadius: '10px', border: BORDE_PANEL, boxShadow: '0 12px 32px rgba(0,0,0,.16)' } } }, // estilos-sueltos: ok
        }}
      >
        {OPCIONES_ORDEN.map((o) => (
          <MenuItem key={o.valor} value={o.valor} sx={{ py: '10px', px: '12px', fontSize: 15, '&.Mui-selected': { bgcolor: 'transparent', fontWeight: 700, color: 'primary.main' } /* estilos-sueltos: ok */ }}>
            {o.etiqueta}
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}
