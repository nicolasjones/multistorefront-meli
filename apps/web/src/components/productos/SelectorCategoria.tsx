import { Box, Button, MenuItem, Stack, TextField } from '@mui/material'
import { type Categoria, opcionesCategoriaProducto } from '../../lib/categorias'

type Props = {
  categorias: readonly Categoria[]
  // Id de la categoría elegida ('' = sin categoría).
  valor: string
  onCambiar: (categoriaId: string) => void
  cargando?: boolean
  hayError?: boolean
  onReintentar?: () => void
  soloLectura?: boolean
  deshabilitado?: boolean
}

// Selector opcional de categoría del alta y la edición de productos (F-CAT-08, FR-022): las categorías
// raíz y sus subcategorías (2 niveles), con la ruta «Padre > Hija». El prototipo dice «hasta 3.er nivel»;
// acá son 2 (Decisión 1 de la spec). Si la categoría actual ya no figura en la lista (p. ej. sin permiso
// de lectura en Categorías) se conserva sin mostrar un identificador técnico.
export function SelectorCategoria({ categorias, valor, onCambiar, cargando = false, hayError = false, onReintentar, soloLectura = false, deshabilitado = false }: Props) {
  const opciones = opcionesCategoriaProducto(categorias)
  const enLista = opciones.some((opcion) => opcion.id === valor)
  return (
    <Box>
      <TextField
        select
        label="Categoría"
        value={enLista ? valor : ''}
        onChange={(evento) => onCambiar(evento.target.value)}
        disabled={soloLectura || deshabilitado || cargando}
        error={hayError}
        helperText={
          cargando ? 'Cargando categorías…'
            : hayError ? 'No pudimos cargar las categorías.'
              : valor !== '' && !enLista ? 'La categoría actual no se puede mostrar con tu rol; se conserva si no la cambiás.'
                : 'Opcional. Hasta 2 niveles: categoría y subcategoría.'
        }
        fullWidth
      >
        <MenuItem value="">Sin categoría</MenuItem>
        {opciones.map((opcion) => (
          <MenuItem key={opcion.id} value={opcion.id} sx={{ pl: opcion.nivel === 1 ? 4 : undefined }}>{opcion.ruta}</MenuItem>
        ))}
      </TextField>
      {hayError && onReintentar ? (
        <Stack direction="row" sx={{ mt: 0.5 }}><Button size="small" onClick={onReintentar}>Reintentar categorías</Button></Stack>
      ) : null}
    </Box>
  )
}
