import { Box, Button, ButtonBase, InputBase, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material'
import { useState } from 'react'
import type { CategoriaListado, FiltrosCatalogo } from '../../../lib/tiendaListado'
import { filasPanelCategorias } from '../../../lib/tiendaCategorias'
import { BORDE_CAMPO } from '../layout/medidas'

type Props = {
  categorias: CategoriaListado[]
  filtros: FiltrosCatalogo
  alElegirCategoria: (id: string | null) => void
  alCambiarStock: (soloConStock: boolean) => void
  alCambiarPrecioMax: (precioMax: number | null) => void
  alLimpiar: () => void
  // El panel móvil (F-TDA-17) pone «Limpiar» en su encabezado.
  ocultarLimpiar?: boolean
}

// Panel de filtros (F-TDA-12, FR-035): «Categorías» (con «Todos los productos» y conteos),
// «Disponibilidad» · «Solo con stock», «Precio máximo» ($ / «Sin límite») y «Limpiar filtros».
export function PanelFiltros({ categorias, filtros, alElegirCategoria, alCambiarStock, alCambiarPrecioMax, alLimpiar, ocultarLimpiar = false }: Props) {
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
    <Box component="aside" aria-label="Filtros del catálogo">
      <Box component="nav" aria-label="Filtrar por categoría" sx={estiloBloque}>
        <Typography component="h2" variant="h6" sx={estiloTitulo}>Categorías</Typography>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton selected={filtros.categoria === null} onClick={() => alElegirCategoria(null)} aria-current={filtros.categoria === null ? 'true' : undefined} sx={estiloFila}>
              <ListItemText primary="Todos los productos" slotProps={{ primary: { sx: { fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' } } }} />
            </ListItemButton>
          </ListItem>
          {filasPanelCategorias(categorias, filtros.categoria).map(({ categoria: c, nivel }) => (
            <ListItem key={c.id} disablePadding>
              <ListItemButton
                selected={filtros.categoria === c.id}
                aria-current={filtros.categoria === c.id ? 'true' : undefined}
                onClick={() => alElegirCategoria(c.id)}
                sx={{ ...estiloFila, pl: `${nivel * 16}px` }}
              >
                <ListItemText primary={c.nombre} slotProps={{ primary: { sx: { fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' } } }} />
                <Typography component="span" color="text.secondary" aria-label={`${c.productos} productos`} sx={{ fontSize: 'inherit', fontWeight: 400, ml: 1 }}>{c.productos}</Typography>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>

      <Box component="section" aria-labelledby="filtro-disponibilidad" sx={estiloBloque}>
        <Typography id="filtro-disponibilidad" component="h2" variant="h6" sx={estiloTitulo}>Disponibilidad</Typography>
        {/* Casilla del prototipo (`.cbx`): botón con estado (`aria-pressed`) y un cuadro de 18 px que se llena con el primario. */}
        <ButtonBase
          aria-pressed={filtros.soloConStock}
          onClick={() => alCambiarStock(!filtros.soloConStock)}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: 15, py: '5px', color: 'inherit', fontFamily: 'inherit', '&.Mui-focusVisible': { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'primary.main', outlineOffset: '2px' } /* estilos-sueltos: ok */ }}
        >
          <Box
            component="span"
            aria-hidden
            sx={{
              width: 18, height: 18, borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', // estilos-sueltos: ok
              border: '2px solid', borderColor: filtros.soloConStock ? 'primary.main' : 'rgba(0,0,0,.35)', bgcolor: filtros.soloConStock ? 'primary.main' : 'background.paper', color: 'primary.contrastText', // estilos-sueltos: ok
            }}
          >
            {filtros.soloConStock ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
            ) : null}
          </Box>
          Solo con stock
        </ButtonBase>
      </Box>

      <Box component="section" aria-labelledby="filtro-precio" sx={estiloBloque}>
        <Typography id="filtro-precio" component="h2" variant="h6" sx={estiloTitulo}>Precio máximo</Typography>
        {/* Campo del prototipo (`.fin`): 40 px de alto, borde de 1,5 px, radio 8, el «$» en gris y «Sin límite» de apoyo. */}
        <InputBase
          fullWidth
          placeholder="Sin límite"
          value={texto}
          onChange={(evento) => setEdicion(evento.target.value)}
          onBlur={aplicarPrecio}
          onKeyDown={(evento) => { if (evento.key === 'Enter') aplicarPrecio() }}
          startAdornment={<Box component="span" aria-hidden sx={{ color: 'text.secondary', mr: '6px' }}>$</Box>}
          inputProps={{ 'aria-labelledby': 'filtro-precio', inputMode: 'numeric' }}
          sx={{
            height: 40, px: '12px', fontSize: 15, border: BORDE_CAMPO, borderRadius: '8px', bgcolor: 'background.paper', // estilos-sueltos: ok
            '&.Mui-focused': { borderColor: 'primary.main', outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'primary.main', outlineOffset: '1px' }, // estilos-sueltos: ok
            '& input::placeholder': { color: 'text.secondary', opacity: 1 },
          }}
        />
      </Box>

      {ocultarLimpiar ? null : (
        <Button variant="text" onClick={alLimpiar} sx={{ display: 'block', mt: 2, p: 0, minWidth: 0, fontSize: 14, fontWeight: 600, '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } /* estilos-sueltos: ok */ }}>Limpiar filtros</Button>
      )}
    </Box>
  )
}

// Prototipo: cada bloque del panel con 18 px de aire arriba y abajo y una línea inferior; títulos de 18 px en la tipografía de títulos.
const estiloBloque = { py: '18px', borderBottom: '1px solid rgba(0,0,0,.1)' } as const // estilos-sueltos: ok
const estiloTitulo = { fontSize: 18, fontWeight: 700, mb: '8px' } as const // estilos-sueltos: ok
// Fila de categoría (`.catl`): 15 px, 7 px de alto de relleno, el conteo a la derecha; la elegida en negrita y color primario.
const estiloFila = {
  py: '7px', px: 0, fontSize: 15, justifyContent: 'space-between', // estilos-sueltos: ok
  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'transparent', fontWeight: 700, color: 'primary.main' },
  '&:hover': { bgcolor: 'transparent' },
} as const
