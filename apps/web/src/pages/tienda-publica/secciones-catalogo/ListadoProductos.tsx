import { Box, Typography } from '@mui/material'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { EstadoCargaPagina, EstadoError } from '../../../components/estados/EstadosPagina'
import { useCatalogoPublico } from '../../../hooks/useCatalogoPublico'
import {
  FILTROS_INICIALES,
  conCambio,
  parsearFiltros,
  serializarFiltros,
  type FiltrosCatalogo,
} from '../../../lib/tiendaListado'
import { EstadoVacioCatalogo } from '../catalogo/EstadoVacio'
import { Ordenar } from '../catalogo/Ordenar'
import { Paginacion } from '../catalogo/Paginacion'
import { PanelFiltros } from '../catalogo/PanelFiltros'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'
import type { PropsSeccionCatalogo } from '../seccionesCatalogo'

export const orden = 10

// Listado con filtros, orden y paginación (F-TDA-12, FR-035…FR-041). Lo montan `/catalogo`
// (`categoriaId` nulo: la categoría va en `?categoria=`) y `/categoria/:categoriaId` (categoría fija en
// el path). Todo el estado vive en la URL: abrir una URL copiada da el mismo resultado y cambiar un
// filtro es navegación del lado del cliente (sin recargar la página).
export default function ListadoProductos({ host, categoriaId }: PropsSeccionCatalogo) {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const navegar = useNavigate()
  const filtros = parsearFiltros(params, categoriaId)
  const catalogo = useCatalogoPublico(host, filtros)

  const enCategoria = categoriaId !== null
  const consulta = (f: FiltrosCatalogo) => {
    const texto = serializarFiltros(f, !enCategoria).toString()
    return texto ? `?${texto}` : ''
  }
  const aplicar = (f: FiltrosCatalogo) => navegar(`${pathname}${consulta(f)}`)

  const elegirCategoria = (id: string | null) => {
    const nuevo = conCambio(filtros, { categoria: id })
    if (enCategoria) {
      navegar(id ? `/categoria/${id}${consulta(nuevo)}` : `/catalogo${serializarFiltrosSinCategoria(nuevo)}`)
    } else {
      navegar(`/catalogo${consulta(nuevo)}`)
    }
  }
  const limpiar = () => {
    const base = { ...FILTROS_INICIALES, categoria: filtros.categoria }
    aplicar(base)
  }

  const categorias = catalogo.fase === 'lista' ? catalogo.pagina.categorias : []

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '240px minmax(0, 1fr)' }, alignItems: 'start' }}>
      <PanelFiltros
        categorias={categorias}
        filtros={filtros}
        alElegirCategoria={elegirCategoria}
        alCambiarStock={(soloConStock) => aplicar(conCambio(filtros, { soloConStock }))}
        alCambiarPrecioMax={(precioMax) => aplicar(conCambio(filtros, { precioMax }))}
        alLimpiar={limpiar}
      />
      <Box component="section" aria-label="Productos">
        {catalogo.fase === 'cargando' ? <EstadoCargaPagina lineas={4} /> : null}
        {catalogo.fase === 'error' ? (
          <EstadoError titulo="No pudimos cargar los productos." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={catalogo.reintentar} />
        ) : null}
        {catalogo.fase === 'lista' ? (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
              <Typography data-testid="catalogo-contador" role="status" aria-live="polite">
                {catalogo.pagina.total === 1 ? '1 producto' : `${catalogo.pagina.total} productos`}
              </Typography>
              <Ordenar orden={filtros.orden} alCambiar={(nuevoOrden) => aplicar(conCambio(filtros, { orden: nuevoOrden }))} />
            </Box>
            {catalogo.pagina.productos.length === 0 ? (
              <EstadoVacioCatalogo alLimpiar={limpiar} />
            ) : (
              <Box
                component="ul"
                sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
              >
                {catalogo.pagina.productos.map((p) => (
                  <li key={p.id}>
                    <TarjetaProducto producto={p} urlImagen={p.imagen ? catalogo.imagenes[p.imagen] : undefined} />
                  </li>
                ))}
              </Box>
            )}
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
              <Paginacion
                pagina={catalogo.pagina.pagina}
                total={catalogo.pagina.total}
                tamano={catalogo.pagina.tamano}
                hrefPagina={(n) => `${pathname}${consulta({ ...filtros, pagina: n })}`}
              />
            </Box>
          </>
        ) : null}
      </Box>
    </Box>
  )
}

function serializarFiltrosSinCategoria(f: FiltrosCatalogo): string {
  const texto = serializarFiltros({ ...f, categoria: null }).toString()
  return texto ? `?${texto}` : ''
}
