import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import { Box, Button, Drawer, IconButton, Typography } from '@mui/material'
import { useState } from 'react'
import { contarFiltrosActivos, type CategoriaListado, type FiltrosCatalogo, type OrdenCatalogo } from '../../../lib/tiendaListado'
import { Ordenar } from './Ordenar'
import { PanelFiltros } from './PanelFiltros'

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

const soloLector = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

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
      <Button
        variant="outlined"
        startIcon={<TuneIcon />}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? ID_PANEL : undefined}
        onClick={() => setAbierto(true)}
        data-testid="filtrar-movil"
        sx={{ minHeight: 44 }}
      >
        Filtrar
        {activos > 0 ? (
          <>
            <Box component="span" aria-hidden sx={{ ml: 0.5 }}>· {activos}</Box>
            <Box component="span" sx={soloLector}>{activos === 1 ? ', 1 filtro activo' : `, ${activos} filtros activos`}</Box>
          </>
        ) : null}
      </Button>
      <Drawer
        open={abierto}
        onClose={cerrar}
        anchor="bottom"
        slotProps={{ paper: { id: ID_PANEL, 'aria-labelledby': ID_TITULO, sx: { maxHeight: '90vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id={ID_TITULO} component="h2" variant="h6" sx={{ flex: 1 }}>Filtros</Typography>
          <Button onClick={alLimpiar} sx={{ minHeight: 44 }}>Limpiar</Button>
          <IconButton aria-label="Cerrar filtros" onClick={cerrar} sx={{ width: 48, height: 48 }}><CloseIcon /></IconButton>
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
          <Button fullWidth variant="contained" onClick={cerrar} sx={{ minHeight: 48 }}>{verProductos}</Button>
        </Box>
      </Drawer>
    </>
  )
}
