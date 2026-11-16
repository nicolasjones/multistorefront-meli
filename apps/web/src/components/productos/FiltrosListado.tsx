import { Autocomplete, Box, Button, Chip, InputAdornment, Stack, TextField, Tooltip } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { BarraHerramientas } from '../pagina/BarraHerramientas'
import { FiltroEmpresa } from '../pagina/FiltroEmpresa'
import { DISPONIBILIDADES, type Disponibilidad } from '../../lib/productos'
import { opcionesCategoriaProducto, type Categoria } from '../../lib/categorias'
import { LARGO_MAXIMO_BUSQUEDA, type GrupoCompatible, type ColumnaOrdenProducto, type DireccionOrden, type FiltroEstadoProducto } from '../../lib/productosListado'
import { SOLO_LECTORES } from '../base/solo-lectores'

// Filtros que llegan con otras épicas (FR-004): se ven, pero deshabilitados y con su explicación.
const FILTROS_PENDIENTES: ReadonlyArray<{ etiqueta: string; motivo: string }> = [
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
  // Enter en el buscador (lector de códigos de barras, F-CAT-14, FR-013): consulta sin la espera de tipeo.
  onBuscar?: () => void
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
  // Filtro de disponibilidad (F-CAT-17, FR-009): Todos o una; se resuelve en el servidor.
  disponibilidad?: Disponibilidad | null
  onDisponibilidad?: (disponibilidad: Disponibilidad | null) => void
  // Filtro «Compatible con» (F-CAT-09, FR-003): selector múltiple; muestra productos con ALGUNO de los valores.
  grupoCompatibles?: ReadonlyArray<GrupoCompatible>
  compatibles?: ReadonlyArray<string>
  onCompatibles?: (claves: string[]) => void
  errorCompatibles?: boolean
}

// Barra de búsqueda y filtros del listado de productos. Solo presenta: el estado y la espera de
// tipeo viven en la pantalla (el texto sube sin demora; ella decide cuándo consultar).
export function FiltrosListado({ texto, onTexto, onBuscar, estado, onEstado, columnaOrden, direccion, onOrden, hayFiltros, onLimpiar, contador, ayuda, empresas = [], empresaId = null, onEmpresa, errorEmpresas = false, categorias = [], categoriaId = null, onCategoria, disponibilidad = null, onDisponibilidad, grupoCompatibles = [], compatibles = [], onCompatibles, errorCompatibles = false }: FiltrosListadoProps) {
  const opcionesCategoria = opcionesCategoriaProducto(categorias)
  return (
    <BarraHerramientas contador={contador} ayuda={ayuda}>
      <TextField
        type="search"
        size="small"
        label="Buscar por nombre, SKU o código de barras"
        value={texto}
        onChange={(evento) => onTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key !== 'Enter') return
          evento.preventDefault()
          onBuscar?.()
        }}
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
      {onEmpresa ? (
        <FiltroEmpresa
          empresas={empresas}
          valor={empresaId}
          onCambiar={onEmpresa}
          hayError={errorEmpresas}
        />
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
      {onDisponibilidad ? (
        <TextField
          select
          size="small"
          label="Disponibilidad"
          value={disponibilidad ?? ''}
          onChange={(evento) => onDisponibilidad(evento.target.value === '' ? null : (evento.target.value as Disponibilidad))}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 180 }}
        >
          <option value="">Todos</option>
          {DISPONIBILIDADES.map(({ valor, etiqueta }) => <option key={valor} value={valor}>{etiqueta}</option>)}
        </TextField>
      ) : null}
      {onCompatibles && (grupoCompatibles.length > 0 || errorCompatibles) ? (
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 220, maxWidth: '100%' }}
          clearText="Borrar"
          openText="Abrir"
          closeText="Cerrar"
          noOptionsText="No hay valores que coincidan"
          options={grupoCompatibles}
          value={grupoCompatibles.filter((grupo) => compatibles.includes(grupo.clave))}
          getOptionLabel={(grupo) => grupo.etiqueta}
          isOptionEqualToValue={(a, b) => a.clave === b.clave}
          onChange={(_, elegidos) => onCompatibles(elegidos.map((grupo) => grupo.clave))}
          renderInput={(parametros) => (
            <TextField
              {...parametros}
              label="Compatible con"
              error={errorCompatibles}
              helperText={errorCompatibles ? 'No pudimos cargar los valores.' : undefined}
            />
          )}
        />
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
        <Box component="span" role="status" aria-live="polite" sx={SOLO_LECTORES}>
          {`Ordenado por ${OPCIONES_ORDEN.find(({ valor }) => valor === columnaOrden)?.etiqueta ?? columnaOrden}, ${direccion === 'asc' ? 'ascendente' : 'descendente'}`}
        </Box>
      </Stack>
      {hayFiltros ? <Button size="small" onClick={onLimpiar}>Limpiar filtros</Button> : null}
    </BarraHerramientas>
  )
}
