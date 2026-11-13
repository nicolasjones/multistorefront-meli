import { IconButton } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useBack } from '@refinedev/core'

// Reemplaza la flecha «volver» que `@refinedev/mui` dibuja en el encabezado de `Create`/`Edit`/`Show`: esa
// versión es un `IconButton` sin nombre accesible (axe: `button-name`) y no admite una etiqueta. Se pasa como `goBack`.
export function BotonVolver() {
  const volver = useBack()
  return (
    <IconButton aria-label="Volver" onClick={volver}>
      <ArrowBackIcon />
    </IconButton>
  )
}
