import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import { Box, Button, Drawer, IconButton, Typography } from '@mui/material'
import { useState } from 'react'
import { OPCIONES_ORDEN, contarFiltrosActivos, type CategoriaListado, type FiltrosCatalogo, type OrdenCatalogo } from '../../../lib/tiendaListado'
import { Ordenar } from './Ordenar'
import { PanelFiltros } from './PanelFiltros'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'

type Props = {
  categorias: CategoriaListado[]
  filtros: FiltrosCatalogo
  // Total de productos del resultado vigente (null mientras carga): rotula «Ver N productos».
  total: number | null
  // En `/categoria/:id` la categoría la fija el path: no cuenta como filtro activo.
  categoriaFija: boolean
  alElegirCategoria: (id: string | null) => void
  alCambiarStock: (soloConStock: boolean) => void
  alCambiarPrecioMax: (precioMax: number | null) => void
  alCambiarOrden: (orden: OrdenCatalogo) => void
  alLimpiar: () => void
}


// Botón de la fila de celular: ocupa la mitad, borde de 1,5 px, radio 8, 10 px de relleno y texto en tinta a 16 px / 400.
const estiloBotonFila = {
  flex: 1, py: '10px', px: '10px', fontSize: 16, fontWeight: 400, color: 'text.primary', border: '1.5px solid rgba(0,0,0,.18)', borderRadius: '8px', bgcolor: 'background.paper', // estilos-sueltos: ok
  '&:hover': { border: '1.5px solid rgba(0,0,0,.18)', bgcolor: 'background.paper' }, // estilos-sueltos: ok
} as const

const ID_PANEL = 'filtros-movil'
const ID_TITULO = 'filtros-movil-titulo'

// Filtros en celular (F-TDA-17, FR-041/FR-048): botón «Filtrar» con la cantidad de filtros activos y un
// panel «Filtros» con «Limpiar», Categoría, «Solo con stock», «Precio máximo» (D5) y Ordenar. Los
// cambios van a la URL al instante, igual que en escritorio (mismo estado, MSF-167); «Ver N productos»
// solo cierra el panel sobre el resultado ya aplicado. El Drawer de MUI atrapa el foco, lo devuelve al
// botón y cierra con Esc o al tocar afuera.
export default function PanelFiltrosMovil({ categorias, filtros, total, categoriaFija, alElegirCategoria, alCambiarStock, alCambiarPrecioMax, alCambiarOrden, alLimpiar }: Props) {
  const [abierto, setAbierto] = useState(false)
  const activos = contarFiltrosActivos(filtros, categoriaFija)
  const cerrar = () => setAbierto(false)
  const verProductos = total === null ? 'Ver productos' : total === 1 ? 'Ver 1 producto' : `Ver ${total} productos`

  return (
    <>
      {/* Prototipo (`MJC_M_Catalogo`): dos botones iguales en una fila de 10 px de separación —«Filtrar» con la cantidad de filtros
          activos en una píldora primaria, y el orden vigente con «▾»— que abren el mismo panel. */}
      <Box sx={{ display: 'flex', gap: '10px', py: '12px' /* estilos-sueltos: ok */ }}>
        <Button
          variant="outlined"
          startIcon={<TuneIcon />}
          aria-haspopup="dialog"
          aria-expanded={abierto}
          aria-controls={abierto ? ID_PANEL : undefined}
          onClick={() => setAbierto(true)}
          data-testid="filtrar-movil"
          sx={{ ...estiloBotonFila, '& .MuiButton-startIcon': { mr: '8px', ml: 0 } }}
        >
          Filtrar
          {activos > 0 ? (
            <>
              <Box component="span" aria-hidden sx={{ ml: '8px', bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: '999px', fontSize: 12, px: '7px', py: '2px' /* estilos-sueltos: ok */ }}>{activos}</Box>
              <Box component="span" sx={SOLO_LECTORES}>{activos === 1 ? ', 1 filtro activo' : `, ${activos} filtros activos`}</Box>
            </>
          ) : null}
        </Button>
        <Button
          variant="outlined"
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
          data-testid="orden-movil"
          sx={estiloBotonFila}
        >
          {OPCIONES_ORDEN.find((o) => o.valor === filtros.orden)?.etiqueta ?? ''} ▾
        </Button>
      </Box>
      <Drawer
        open={abierto}
        onClose={cerrar}
        anchor="bottom"
        slotProps={{ paper: { id: ID_PANEL, role: 'dialog', 'aria-modal': true, 'aria-labelledby': ID_TITULO, sx: { maxHeight: '90vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id={ID_TITULO} component="h2" variant="h6" sx={{ flex: 1 }}>Filtros</Typography>
          <Button onClick={alLimpiar} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Limpiar</Button>
          <IconButton aria-label="Cerrar filtros" onClick={cerrar} sx={{ width: 48, height: (tema) => tema.spacing(6) }}><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <PanelFiltros
            categorias={categorias}
            filtros={filtros}
            ocultarLimpiar
            alElegirCategoria={alElegirCategoria}
            alCambiarStock={alCambiarStock}
            alCambiarPrecioMax={alCambiarPrecioMax}
            alLimpiar={alLimpiar}
          />
          <Ordenar orden={filtros.orden} alCambiar={alCambiarOrden} />
        </Box>
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button fullWidth variant="contained" onClick={cerrar} sx={{ minHeight: (tema) => tema.spacing(6) }}>{verProductos}</Button>
        </Box>
      </Drawer>
    </>
  )
}
