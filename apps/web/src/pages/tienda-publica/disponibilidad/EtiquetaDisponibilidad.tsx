import { Box, Typography } from '@mui/material'

export interface PropsEtiquetaDisponibilidad {
  disponible: boolean
  // `tarjeta` (por defecto): 13 px (12 px en celular) con punto de 8 px. `ficha`: 16 px/600 con punto de 10 px (prototipo `MJC_Producto`).
  tamano?: 'tarjeta' | 'ficha'
}

// Colores del estado (prototipo): «Disponible» en verde (`success.main`, #2E7D32) y «Sin stock» en gris (#6B6B6B); los dos
// cumplen contraste AA sobre fondo claro.
const COLOR_SIN_STOCK = '#6B6B6B' // estilos-sueltos: ok

// F-TDA-18 (FR-022, FR-023): solo el estado «Disponible» / «Sin stock», nunca cantidades («Últimas unidades» del
// prototipo no se implementa: la plataforma no expone cantidades). El estado va en texto (no solo color) para que lo lea
// cualquier lector de pantalla; el punto es decorativo y toma el color del texto.
export default function EtiquetaDisponibilidad({ disponible, tamano = 'tarjeta' }: PropsEtiquetaDisponibilidad) {
  const ficha = tamano === 'ficha'
  return (
    <Typography
      component="span"
      data-testid="etiqueta-disponibilidad"
      data-disponible={disponible}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: ficha ? '8px' : '6px', fontSize: ficha ? 16 : { xs: 12, md: 13 }, fontWeight: ficha ? 600 : 500, // estilos-sueltos: ok
        color: disponible ? 'success.main' : COLOR_SIN_STOCK,
      }}
    >
      <Box component="span" aria-hidden sx={{ width: ficha ? 10 : 8, height: ficha ? 10 : 8, borderRadius: '50%', bgcolor: 'currentColor', flexShrink: 0, display: 'inline-block' /* estilos-sueltos: ok */ }} />
      {disponible ? 'Disponible' : 'Sin stock'}
    </Typography>
  )
}
