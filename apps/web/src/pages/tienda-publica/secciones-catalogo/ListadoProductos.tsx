import { Box, Typography } from '@mui/material'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useCatalogoPublico } from '../../../hooks/useCatalogoPublico'
import { normalizarConsulta, urlResultados } from '../../../lib/tiendaBusqueda'
import {
  FILTROS_INICIALES,
  conCambio,
  parsearFiltros,
  serializarFiltros,
  type CategoriaListado,
  type FiltrosCatalogo,
} from '../../../lib/tiendaListado'
import { EstadoVacioCatalogo } from '../catalogo/EstadoVacio'
import { Ordenar } from '../catalogo/Ordenar'
import { Paginacion } from '../catalogo/Paginacion'
import { PanelFiltros } from '../catalogo/PanelFiltros'
import { TarjetaProducto } from '../catalogo/TarjetaProducto'
import type { PropsSeccionCatalogo } from '../seccionesCatalogo'
import { useCelular } from '../useAnchoCelular'
import { ErrorConReintento } from '../ErrorConReintento'

export const orden = 10

// Panel de filtros de celular (F-TDA-17, FR-041/FR-047): carga diferida, solo se baja en anchos de celular.
const PanelFiltrosMovil = lazy(() => import('../catalogo/PanelFiltrosMovil'))

// Listado con filtros, orden y paginación (F-TDA-12, FR-035…FR-041). Lo montan `/catalogo`
// (`categoriaId` nulo: la categoría va en `?categoria=`) y `/categoria/:categoriaId` (categoría fija en
// el path). Todo el estado vive en la URL: abrir una URL copiada da el mismo resultado y cambiar un
// filtro es navegación del lado del cliente (sin recargar la página). Con `?q=` en `/catalogo`
// (F-TDA-15, FR-025) lista los resultados de la búsqueda y `q` se conserva al cambiar filtros.
export default function ListadoProductos({ host, categoriaId }: PropsSeccionCatalogo) {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const navegar = useNavigate()
  const filtros = parsearFiltros(params, categoriaId)
  const enCategoria = categoriaId !== null
  // `q` solo rige en `/catalogo`; vacía o con solo espacios es el catálogo común (FR-025).
  const q = enCategoria ? null : normalizarConsulta(params.get('q')) || null
  const catalogo = useCatalogoPublico(host, filtros, q)
  // Bajo `md` los filtros van en un panel (FR-041); desde `md`, en la columna lateral.
  const movil = useCelular()

  // `q` va primero en la URL y se conserva en cada cambio de filtro, orden o página.
  const consulta = (f: FiltrosCatalogo, incluirCategoria = !enCategoria) => {
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    serializarFiltros(f, incluirCategoria).forEach((valor, clave) => query.set(clave, valor))
    const texto = query.toString()
    return texto ? `?${texto}` : ''
  }
  const aplicar = (f: FiltrosCatalogo) => navegar(`${pathname}${consulta(f)}`)

  const elegirCategoria = (id: string | null) => {
    const nuevo = conCambio(filtros, { categoria: id })
    if (enCategoria) {
      navegar(id ? `/categoria/${id}${consulta(nuevo)}` : `/catalogo${consulta(nuevo, false)}`)
    } else {
      navegar(`/catalogo${consulta(nuevo)}`)
    }
  }
  // En `/catalogo` «Limpiar filtros» quita todo (también la categoría, como el prototipo) pero conserva
  // la búsqueda; en la ruta de categoría el path manda y solo se limpian stock, precio, orden y página
  // (FR-035, FR-038).
  const limpiar = () => {
    if (enCategoria) {
      aplicar({ ...FILTROS_INICIALES, categoria: filtros.categoria })
    } else {
      navegar(q ? urlResultados(q) : '/catalogo')
    }
  }

  // Límite de pedidos (FR-027): el aviso se anuncia y, pasado el tiempo, la búsqueda se repite sola.
  const espera = catalogo.fase === 'lista' ? (catalogo.pagina.esperaSegundos ?? null) : null
  const { reintentar } = catalogo
  useEffect(() => {
    if (espera === null) return undefined
    const temporizador = setTimeout(reintentar, espera * 1000)
    return () => clearTimeout(temporizador)
  }, [espera, reintentar])

  // Las últimas categorías leídas se conservan mientras carga, para que el panel no parpadee.
  const ultimasCategorias = useRef<CategoriaListado[]>([])
  if (catalogo.fase === 'lista') ultimasCategorias.current = catalogo.pagina.categorias
  const categorias = ultimasCategorias.current

  // Página fuera de rango (p. ej. `?pagina=999`): se lleva a la última página real en vez de mostrar
  // «sin resultados» con un contador que no coincide.
  const fuera = catalogo.fase === 'lista' ? catalogo.pagina : null
  const ultimaPagina = fuera ? Math.max(1, Math.ceil(fuera.total / fuera.tamano)) : 1
  const irAUltima = fuera !== null && fuera.total > 0 && fuera.pagina > ultimaPagina
  useEffect(() => {
    if (irAUltima) navegar(`${pathname}${consulta({ ...filtros, pagina: ultimaPagina })}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irAUltima, ultimaPagina])

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '240px minmax(0, 1fr)' }, alignItems: 'start' }}>
      {movil ? null : (
        <PanelFiltros
          categorias={categorias}
          filtros={filtros}
          alElegirCategoria={elegirCategoria}
          alCambiarStock={(soloConStock) => aplicar(conCambio(filtros, { soloConStock }))}
          alCambiarPrecioMax={(precioMax) => aplicar(conCambio(filtros, { precioMax }))}
          alLimpiar={limpiar}
        />
      )}
      <Box component="section" aria-label="Productos">
        {catalogo.fase === 'cargando' ? <EstadoCargaPagina lineas={4} /> : null}
        {catalogo.fase === 'error' ? (
          <ErrorConReintento titulo="No pudimos cargar los productos." alReintentar={catalogo.reintentar} />
        ) : null}
        {catalogo.fase === 'lista' && espera !== null ? (
          <Box data-testid="busqueda-espera" role="status" sx={{ py: 6, textAlign: 'center' }}>
            <Typography component="h2" variant="h6" gutterBottom>Hiciste muchas búsquedas seguidas</Typography>
            <Typography color="text.secondary">
              Esperá {espera === 1 ? '1 segundo' : `${espera} segundos`} y los resultados aparecen solos.
            </Typography>
          </Box>
        ) : null}
        {catalogo.fase === 'lista' && espera === null ? (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
              <Typography data-testid="catalogo-contador" role="status" aria-live="polite">
                {catalogo.pagina.total === 1 ? '1 producto' : `${catalogo.pagina.total} productos`}
              </Typography>
              {movil ? (
                <Suspense fallback={<Box sx={{ height: 44 }} aria-hidden />}>
                  <PanelFiltrosMovil
                    categorias={categorias}
                    filtros={filtros}
                    total={catalogo.pagina.total}
                    categoriaFija={enCategoria}
                    alElegirCategoria={elegirCategoria}
                    alCambiarStock={(soloConStock) => aplicar(conCambio(filtros, { soloConStock }))}
                    alCambiarPrecioMax={(precioMax) => aplicar(conCambio(filtros, { precioMax }))}
                    alCambiarOrden={(nuevoOrden) => aplicar(conCambio(filtros, { orden: nuevoOrden }))}
                    alLimpiar={limpiar}
                  />
                </Suspense>
              ) : (
                <Ordenar orden={filtros.orden} alCambiar={(nuevoOrden) => aplicar(conCambio(filtros, { orden: nuevoOrden }))} />
              )}
            </Box>
            {catalogo.pagina.productos.length === 0 ? (
              <EstadoVacioCatalogo alLimpiar={limpiar} />
            ) : (
              <Box
                component="ul"
                sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(160px, 1fr))' } }}
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
