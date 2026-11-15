import { Box, Button, Stack, Typography } from '@mui/material'
import { MAXIMO_SELECCION } from '../../hooks/useSeleccionProductos'

type Props = {
  cantidad: number
  onMoverCategoria: () => void
  onCambiarEstado: () => void
  onCambiarEmpresas: () => void
  onQuitar: () => void
}

// Barra de acciones masivas del listado (F-CAT-12, FR-002). Texto y orden del prototipo
// (Productos.dc.html): «N seleccionados», «Mover de categoría» y «Quitar selección» a la derecha.
// «Cambiar estado» y «Cambiar empresas» no están dibujados: usan el mismo patrón de botón.
// Marcar destacado, Enviar al newsletter y Borrar quedan fuera (Decisiones 1 y 2 de la spec).
export function BarraSeleccion({ cantidad, onMoverCategoria, onCambiarEstado, onCambiarEmpresas, onQuitar }: Props) {
  if (cantidad === 0) return null
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      alignItems="center"
      role="region"
      aria-label="Acciones sobre los productos seleccionados"
      sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', borderRadius: 1 }}
    >
      <Typography variant="b" component="b" aria-live="polite" sx={{ fontWeight: 600 }}>{cantidad} seleccionados</Typography>
      {cantidad >= MAXIMO_SELECCION ? <Typography variant="b" color="text.secondary">Máximo {MAXIMO_SELECCION} a la vez</Typography> : null}
      <Button variant="outlined" size="small" onClick={onMoverCategoria}>Mover de categoría</Button>
      <Button variant="outlined" size="small" onClick={onCambiarEstado}>Cambiar estado</Button>
      <Button variant="outlined" size="small" onClick={onCambiarEmpresas}>Cambiar empresas</Button>
      <Box component="span" sx={{ flex: 1 }} />
      <Button size="small" onClick={onQuitar}>Quitar selección</Button>
    </Stack>
  )
}
