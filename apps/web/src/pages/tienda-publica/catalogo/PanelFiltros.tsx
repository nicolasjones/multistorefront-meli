import { Box, Button, InputAdornment, List, ListItem, ListItemButton, ListItemText, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import type { CategoriaListado, FiltrosCatalogo } from '../../../lib/tiendaListado'

type Props = {
  categorias: CategoriaListado[]
  filtros: FiltrosCatalogo
  alElegirCategoria: (id: string | null) => void
  alCambiarStock: (soloConStock: boolean) => void
  alCambiarPrecioMax: (precioMax: number | null) => void
  alLimpiar: () => void
}

// Panel de filtros (F-TDA-12, FR-035): «Categorías» (con «Todos los productos» y conteos),
// «Disponibilidad» · «Solo con stock», «Precio máximo» ($ / «Sin límite») y «Limpiar filtros».
export function PanelFiltros({ categorias, filtros, alElegirCategoria, alCambiarStock, alCambiarPrecioMax, alLimpiar }: Props) {
  // El campo es texto libre mientras se escribe (`edicion`); al salir (o con Enter) se aplica y vuelve a
  // mostrar el filtro vigente de la URL. Vacío, no numérico o ≤ 0 equivale a «Sin límite».
  const [edicion, setEdicion] = useState<string | null>(null)
  const texto = edicion ?? (filtros.precioMax === null ? '' : String(filtros.precioMax))

  const aplicarPrecio = () => {
    if (edicion === null) return
    const limpio = edicion.replace(/[.\s]/g, '')
    const valor = /^[0-9]{1,9}$/.test(limpio) ? Number(limpio) : 0
    const nuevo = valor > 0 ? valor : null
    setEdicion(null)
    if (nuevo !== filtros.precioMax) alCambiarPrecioMax(nuevo)
  }

  return (
    <Box component="aside" aria-label="Filtros del catálogo" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box component="nav" aria-label="Categorías del catálogo">
        <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>Categorías</Typography>
        <List dense disablePadding>
          <ListItem disablePadding>
            <ListItemButton selected={filtros.categoria === null} onClick={() => alElegirCategoria(null)} aria-current={filtros.categoria === null ? 'true' : undefined}>
              <ListItemText primary="Todos los productos" />
            </ListItemButton>
          </ListItem>
          {categorias.map((c) => (
            <ListItem key={c.id} disablePadding>
              <ListItemButton
                selected={filtros.categoria === c.id}
                aria-current={filtros.categoria === c.id ? 'true' : undefined}
                onClick={() => alElegirCategoria(c.id)}
                sx={{ pl: c.padreId ? 3 : 2 }}
              >
                <ListItemText primary={c.nombre} />
                <Typography variant="body2" color="text.secondary" aria-label={`${c.productos} productos`}>{c.productos}</Typography>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>

      <Box component="section" aria-labelledby="filtro-disponibilidad">
        <Typography id="filtro-disponibilidad" component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Disponibilidad</Typography>
        <Button
          variant={filtros.soloConStock ? 'contained' : 'outlined'}
          aria-pressed={filtros.soloConStock}
          onClick={() => alCambiarStock(!filtros.soloConStock)}
        >
          Solo con stock
        </Button>
      </Box>

      <Box component="section" aria-labelledby="filtro-precio">
        <Typography id="filtro-precio" component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Precio máximo</Typography>
        <TextField
          size="small"
          label="Precio máximo"
          placeholder="Sin límite"
          value={texto}
          onChange={(evento) => setEdicion(evento.target.value)}
          onBlur={aplicarPrecio}
          onKeyDown={(evento) => { if (evento.key === 'Enter') aplicarPrecio() }}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
            htmlInput: { inputMode: 'numeric' },
          }}
        />
      </Box>

      <Button variant="text" onClick={alLimpiar} sx={{ alignSelf: 'flex-start' }}>Limpiar filtros</Button>
    </Box>
  )
}
