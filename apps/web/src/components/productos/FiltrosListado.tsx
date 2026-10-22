import { Box, Button, Chip, InputAdornment, Stack, TextField, Tooltip, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { BarraHerramientas } from '../pagina/BarraHerramientas'
import { opcionesCategoriaProducto, type Categoria } from '../../lib/categorias'
import { LARGO_MAXIMO_BUSQUEDA, type ColumnaOrdenProducto, type DireccionOrden, type FiltroEstadoProducto } from '../../lib/productosListado'

// Filtros que llegan con otras épicas (FR-004): se ven, pero deshabilitados y con su explicación.
const FILTROS_PENDIENTES: ReadonlyArray<{ etiqueta: string; motivo: string }> = [
  { etiqueta: 'Sin stock', motivo: 'Disponible cuando llegue el módulo de Stock.' },
  { etiqueta: 'Stock bajo', motivo: 'Disponible cuando llegue el módulo de Stock.' },
  { etiqueta: 'Sin vincular a ML', motivo: 'Disponible cuando se integre Mercado Libre.' },
]

const OPCIONES_ORDEN: ReadonlyArray<{ valor: ColumnaOrdenProducto; etiqueta: string }> = [
  { valor: 'nombre', etiqueta: 'Producto' },
  { valor: 'sku', etiqueta: 'SKU' },
  { valor: 'activo', etiqueta: 'Estado' },
]

type FiltrosListadoProps = {
  texto: string
  onTexto: (texto: string) => void
  estado: FiltroEstadoProducto
  onEstado: (estado: FiltroEstadoProducto) => void
  columnaOrden: ColumnaOrdenProducto
  direccion: DireccionOrden
  onOrden: (columna: ColumnaOrdenProducto, direccion: DireccionOrden) => void
  hayFiltros: boolean
  onLimpiar: () => void
  contador?: string
  ayuda?: string
  // Filtro de tienda (F-CAT-07, FR-013): Todas / una por empresa a la que la persona tiene acceso.
  empresas?: ReadonlyArray<{ id: string; nombre: string }>
  empresaId?: string | null
  onEmpresa?: (empresaId: string | null) => void
  errorEmpresas?: boolean
  // Filtro de categoría (F-CAT-08, FR-022): «Todas» o una (la raíz incluye sus subcategorías).
  categorias?: ReadonlyArray<Categoria>
  categoriaId?: string | null
  onCategoria?: (categoriaId: string | null) => void
}

// Barra de búsqueda y filtros del listado de productos. Solo presenta: el estado y la espera de
// tipeo viven en la pantalla (el texto sube sin demora; ella decide cuándo consultar).
export function FiltrosListado({ texto, onTexto, estado, onEstado, columnaOrden, direccion, onOrden, hayFiltros, onLimpiar, contador, ayuda, empresas = [], empresaId = null, onEmpresa, errorEmpresas = false, categorias = [], categoriaId = null, onCategoria }: FiltrosListadoProps) {
  const opcionesCategoria = opcionesCategoriaProducto(categorias)
  return (
    <BarraHerramientas contador={contador} ayuda={ayuda}>
      <TextField
        type="search"
        size="small"
        label="Buscar por nombre o SKU"
        value={texto}
        onChange={(evento) => onTexto(evento.target.value)}
        slotProps={{
          htmlInput: { maxLength: LARGO_MAXIMO_BUSQUEDA },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" aria-hidden="true" /></InputAdornment> },
        }}
        sx={{ width: 320, maxWidth: '100%' }}
      />
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" role="group" aria-label="Filtrar productos">
        <Chip
          label="Todos"
          clickable
          color={estado === 'todos' ? 'primary' : 'default'}
          variant={estado === 'todos' ? 'filled' : 'outlined'}
          aria-pressed={estado === 'todos'}
          onClick={() => onEstado('todos')}
        />
        <Chip
          label="Inactivos"
          clickable
          color={estado === 'inactivos' ? 'primary' : 'default'}
          variant={estado === 'inactivos' ? 'filled' : 'outlined'}
          aria-pressed={estado === 'inactivos'}
          onClick={() => onEstado('inactivos')}
        />
        {FILTROS_PENDIENTES.map(({ etiqueta, motivo }) => (
          <Tooltip key={etiqueta} title={motivo}>
            <span>
              <Chip label={etiqueta} variant="outlined" clickable disabled aria-label={`${etiqueta}. ${motivo}`} />
            </span>
          </Tooltip>
        ))}
      </Stack>
      {errorEmpresas ? (
        <Typography variant="xs" color="text.secondary">No pudimos cargar las tiendas para filtrar.</Typography>
      ) : empresas.length > 0 && onEmpresa ? (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" role="group" aria-label="Filtrar por tienda">
          <Chip
            label="Todas las tiendas"
            clickable
            color={empresaId === null ? 'primary' : 'default'}
            variant={empresaId === null ? 'filled' : 'outlined'}
            aria-pressed={empresaId === null}
            onClick={() => onEmpresa(null)}
          />
          {empresas.map((empresa) => (
            <Chip
              key={empresa.id}
              label={empresa.nombre}
              clickable
              color={empresaId === empresa.id ? 'primary' : 'default'}
              variant={empresaId === empresa.id ? 'filled' : 'outlined'}
              aria-pressed={empresaId === empresa.id}
              onClick={() => onEmpresa(empresa.id)}
            />
          ))}
        </Stack>
      ) : null}
      {onCategoria && opcionesCategoria.length > 0 ? (
        <TextField
          select
          size="small"
          label="Categoría"
          value={opcionesCategoria.some((opcion) => opcion.id === categoriaId) ? categoriaId : ''}
          onChange={(evento) => onCategoria(evento.target.value === '' ? null : evento.target.value)}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 180 }}
        >
          <option value="">Todas</option>
          {opcionesCategoria.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.nivel === 1 ? `— ${opcion.ruta}` : opcion.ruta}</option>)}
        </TextField>
      ) : null}
      <Stack direction="row" spacing={0.75} alignItems="center" role="group" aria-label="Orden del listado">
        <TextField
          select
          size="small"
          label="Ordenar por"
          value={columnaOrden}
          onChange={(evento) => onOrden(evento.target.value as ColumnaOrdenProducto, direccion)}
          slotProps={{ select: { native: true } }}
          sx={{ minWidth: 140 }}
        >
          {OPCIONES_ORDEN.map(({ valor, etiqueta }) => <option key={valor} value={valor}>{etiqueta}</option>)}
        </TextField>
        <Button
          size="small"
          aria-label={direccion === 'asc' ? 'Orden ascendente. Cambiar a orden descendente' : 'Orden descendente. Cambiar a orden ascendente'}
          onClick={() => onOrden(columnaOrden, direccion === 'asc' ? 'desc' : 'asc')}
        >
          {direccion === 'asc' ? 'Ascendente' : 'Descendente'}
        </Button>
        <Box component="span" role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {`Ordenado por ${OPCIONES_ORDEN.find(({ valor }) => valor === columnaOrden)?.etiqueta ?? columnaOrden}, ${direccion === 'asc' ? 'ascendente' : 'descendente'}`}
        </Box>
      </Stack>
      {hayFiltros ? <Button size="small" onClick={onLimpiar}>Limpiar filtros</Button> : null}
    </BarraHerramientas>
  )
}
