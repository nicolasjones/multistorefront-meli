import { Typography } from '@mui/material'

export interface PropsEtiquetaDisponibilidad {
  disponible: boolean
}

// F-TDA-18 (FR-022, FR-023): solo el estado «Disponible» / «Sin stock», nunca cantidades. El estado
// va en texto (no solo color) para que lo lea cualquier lector de pantalla; los colores del tema
// mantienen contraste AA sobre fondo claro.
export default function EtiquetaDisponibilidad({ disponible }: PropsEtiquetaDisponibilidad) {
  return (
    <Typography
      component="span"
      variant="body2"
      data-testid="etiqueta-disponibilidad"
      data-disponible={disponible}
      sx={{ fontWeight: 600, color: disponible ? 'success.dark' : 'text.secondary' }}
    >
      {disponible ? 'Disponible' : 'Sin stock'}
    </Typography>
  )
}
