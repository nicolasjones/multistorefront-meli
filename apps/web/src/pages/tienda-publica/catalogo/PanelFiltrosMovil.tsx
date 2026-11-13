import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import { Box, Button, ButtonBase, Drawer, IconButton, Typography } from '@mui/material'
import { useState } from 'react'
import { OPCIONES_ORDEN, contarFiltrosActivos, type CategoriaListado, type FiltrosCatalogo, type OrdenCatalogo } from '../../../lib/tiendaListado'
import { filasPanelCategorias } from '../../../lib/tiendaCategorias'
import { CampoPrecioMax, CasillaStock } from './PanelFiltros'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import { BORDE_CAMPO } from '../layout/medidas'

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
  flex: 1, py: '10px', px: '10px', fontSize: 16, fontWeight: 400, color: 'text.primary', border: BORDE_CAMPO, borderRadius: '8px', bgcolor: 'background.paper', // estilos-sueltos: ok
  '&:hover': { border: BORDE_CAMPO, bgcolor: 'background.paper' }, // estilos-sueltos: ok
} as const

// En celular el primer orden se rotula «Relevancia» (prototipo `MJC_M_Catalogo`); en escritorio es «Más relevantes».
const etiquetaOrdenMovil = (valor: OrdenCatalogo) => (valor === 'relevancia' ? 'Relevancia' : (OPCIONES_ORDEN.find((o) => o.valor === valor)?.etiqueta ?? ''))

// Subtítulo de sección de la hoja (14 px/700 en la tipografía de texto) y fila de píldoras (8 px de separación).
const estiloSubtitulo = { fontSize: 14, fontWeight: 700, fontFamily: 'inherit', m: '16px 0 8px' } as const // estilos-sueltos: ok
const estiloFilaPildoras = { display: 'flex', flexWrap: 'wrap', gap: '8px' } as const // estilos-sueltos: ok

// Píldora del prototipo (`.pill`): 14 px/600, radio total, borde de 1,5 px; la elegida se rellena con el primario.
function Pildora({ activa, alElegir, children, ...resto }: { activa: boolean; alElegir: () => void; children: React.ReactNode; 'aria-current'?: 'true' }) {
  return (
    <ButtonBase
      {...resto}
      aria-pressed={activa}
      onClick={alElegir}
      sx={{
        px: '14px', py: '8px', borderRadius: '999px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0, // estilos-sueltos: ok
        border: BORDE_CAMPO, bgcolor: activa ? 'primary.main' : 'background.paper', color: activa ? 'primary.contrastText' : 'text.primary', borderColor: activa ? 'primary.main' : undefined,
        '&.Mui-focusVisible': { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'primary.main', outlineOffset: '2px' }, // estilos-sueltos: ok
      }}
    >
      {children}
    </ButtonBase>
  )
}

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
          {etiquetaOrdenMovil(filtros.orden)} ▾
        </Button>
      </Box>
      <Drawer
        open={abierto}
        onClose={cerrar}
        anchor="bottom"
        slotProps={{ paper: { id: ID_PANEL, role: 'dialog', 'aria-modal': true, 'aria-labelledby': ID_TITULO, sx: { maxHeight: '90vh', borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: '0 -12px 40px rgba(0,0,0,.25)', px: '20px', pt: '16px', pb: '24px' } } }} // estilos-sueltos: ok
      >
        {/* Hoja del prototipo (`MJC_M_Catalogo`, «sheet»): asa, «Filtros» con «Limpiar», subtítulos de 14 px, categorías y orden como
            píldoras, «Solo con stock», «Precio máximo» (D5: el prototipo móvil no lo trae pero el filtro existe) y «Ver N productos» de 48 px. */}
        <Box aria-hidden sx={{ width: 40, height: 4, borderRadius: '2px', bgcolor: 'rgba(0,0,0,.2)', mx: 'auto', mb: '14px', flexShrink: 0 /* estilos-sueltos: ok */ }} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography id={ID_TITULO} component="h2" variant="h6" sx={{ fontSize: 20 /* estilos-sueltos: ok */ }}>Filtros</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button onClick={alLimpiar} sx={{ p: 0, minWidth: 0, fontSize: 16, fontWeight: 400, '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } /* estilos-sueltos: ok */ }}>Limpiar</Button>
            <IconButton aria-label="Cerrar filtros" onClick={cerrar} sx={{ width: 36, height: 36 /* estilos-sueltos: ok */ }}><CloseIcon /></IconButton>
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <Box component="section" aria-labelledby="filtro-categoria-movil">
            <Typography id="filtro-categoria-movil" component="h3" sx={estiloSubtitulo}>Categoría</Typography>
            <Box sx={estiloFilaPildoras}>
              <Pildora activa={filtros.categoria === null} alElegir={() => alElegirCategoria(null)} aria-current={filtros.categoria === null ? 'true' : undefined}>Todo</Pildora>
              {filasPanelCategorias(categorias, filtros.categoria).map(({ categoria: c }) => (
                <Pildora key={c.id} activa={filtros.categoria === c.id} alElegir={() => alElegirCategoria(c.id)} aria-current={filtros.categoria === c.id ? 'true' : undefined}>{c.nombre}</Pildora>
              ))}
            </Box>
          </Box>
          <Box component="section" aria-labelledby="filtro-disponibilidad-movil">
            <Typography id="filtro-disponibilidad-movil" component="h3" sx={{ ...estiloSubtitulo, mb: '4px' }}>Disponibilidad</Typography>
            <CasillaStock activo={filtros.soloConStock} alCambiar={alCambiarStock} />
          </Box>
          <Box component="section" aria-labelledby="filtro-precio-movil">
            <Typography id="filtro-precio-movil" component="h3" sx={estiloSubtitulo}>Precio máximo</Typography>
            <CampoPrecioMax precioMax={filtros.precioMax} alCambiar={alCambiarPrecioMax} idEtiqueta="filtro-precio-movil" />
          </Box>
          <Box component="section" aria-labelledby="filtro-orden-movil">
            <Typography id="filtro-orden-movil" component="h3" sx={estiloSubtitulo}>Ordenar</Typography>
            <Box sx={estiloFilaPildoras}>
              {OPCIONES_ORDEN.map((o) => (
                <Pildora key={o.valor} activa={filtros.orden === o.valor} alElegir={() => alCambiarOrden(o.valor)}>{etiquetaOrdenMovil(o.valor)}</Pildora>
              ))}
            </Box>
          </Box>
        </Box>
        <Button variant="contained" fullWidth onClick={cerrar} sx={{ mt: '20px', height: 48, fontSize: 16, flexShrink: 0 /* estilos-sueltos: ok */ }}>{verProductos}</Button>
      </Drawer>
    </>
  )
}
