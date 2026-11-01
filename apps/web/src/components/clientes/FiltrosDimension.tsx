import { Autocomplete, Stack, TextField } from '@mui/material'
import type { OpcionCategoria, OpcionProducto } from '../../hooks/useOpcionesDimension'

const ANCHO_FILTRO = 240
// Textos de los botones del selector en castellano (los de MUI vienen en inglés).
const TEXTOS_SELECTOR = { clearText: 'Borrar', openText: 'Abrir', closeText: 'Cerrar' } as const

type Props = {
  producto: OpcionProducto | null
  categoriaId: string | null
  provincia: string | null
  alCambiarProducto: (producto: OpcionProducto | null) => void
  alCambiarCategoria: (categoriaId: string | null) => void
  alCambiarProvincia: (provincia: string | null) => void
  /** Texto que se escribe en el selector de producto: el padre busca en el catálogo con él. */
  alBuscarProducto: (texto: string) => void
  productos: OpcionProducto[]
  categorias: OpcionCategoria[]
  provincias: string[]
  cargandoProductos?: boolean
  cargandoCategorias?: boolean
}

const etiquetaProducto = (producto: OpcionProducto) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

// Filtros Producto (búsqueda sobre el catálogo), Categoría y Provincia del ranking (F-CLI-15, FR-009).
// Todos opcionales; las opciones se muestran por nombre, nunca por identificador. Presentacional: el
// estado y las búsquedas viven en `RankingClientes` / `useOpcionesDimension`.
export function FiltrosDimension({
  producto, categoriaId, provincia, alCambiarProducto, alCambiarCategoria, alCambiarProvincia, alBuscarProducto,
  productos, categorias, provincias, cargandoProductos = false, cargandoCategorias = false,
}: Props) {
  const categoria = categorias.find((opcion) => opcion.id === categoriaId) ?? null
  // El producto elegido sigue ofrecido aunque la búsqueda actual ya no lo devuelva.
  const opcionesProducto = producto && !productos.some((opcion) => opcion.id === producto.id) ? [producto, ...productos] : productos

  return (
    <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" role="group" aria-label="Filtros por producto, categoría y provincia">
      <Autocomplete
        size="small" sx={{ width: ANCHO_FILTRO }} {...TEXTOS_SELECTOR}
        options={opcionesProducto} value={producto} loading={cargandoProductos}
        getOptionLabel={etiquetaProducto} isOptionEqualToValue={(a, b) => a.id === b.id}
        // La búsqueda es del servidor: no se vuelve a filtrar en el cliente.
        filterOptions={(opciones) => opciones}
        onChange={(_, valor) => alCambiarProducto(valor)}
        onInputChange={(_, texto, motivo) => { if (motivo === 'input') alBuscarProducto(texto) }}
        loadingText="Buscando productos…" noOptionsText="No hay productos que coincidan"
        renderInput={(parametros) => <TextField {...parametros} label="Producto" />}
      />
      <Autocomplete
        size="small" sx={{ width: ANCHO_FILTRO }} {...TEXTOS_SELECTOR}
        options={categorias} value={categoria} loading={cargandoCategorias}
        getOptionLabel={(opcion) => opcion.ruta} isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, valor) => alCambiarCategoria(valor?.id ?? null)}
        loadingText="Cargando categorías…" noOptionsText="No hay categorías que coincidan"
        renderInput={(parametros) => <TextField {...parametros} label="Categoría" />}
      />
      <Autocomplete
        size="small" sx={{ width: ANCHO_FILTRO }} {...TEXTOS_SELECTOR}
        options={provincias} value={provincia}
        onChange={(_, valor) => alCambiarProvincia(valor)}
        noOptionsText="No hay provincias que coincidan"
        renderInput={(parametros) => <TextField {...parametros} label="Provincia" />}
      />
    </Stack>
  )
}
