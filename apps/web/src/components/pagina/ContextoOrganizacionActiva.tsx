import { Typography } from '@mui/material'
import { useContextoPanel } from '../../hooks/useContextoPanel'

// FR-006: toda pantalla que opera dentro de una organización muestra ese
// contexto de forma discreta, inequívoca y constante — pensado para pasarse
// como `contexto` de EncabezadoPagina en cada una de esas pantallas.
export function ContextoOrganizacionActiva() {
  const { contexto } = useContextoPanel()

  if (!contexto?.organizacion_nombre) {
    return null
  }

  return <Typography variant="body2" color="text.secondary">Organización: {contexto.organizacion_nombre}</Typography>
}
