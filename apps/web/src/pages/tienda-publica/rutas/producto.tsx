import { lazy, Suspense, useEffect } from 'react'
import { Box, Link } from '@mui/material'
import { Link as EnlaceRuta, useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useFichaProducto } from '../../../hooks/useFichaProducto'
import { registrarEventoTienda } from '../../../lib/analiticaTienda'
import { usePreciosCliente } from '../../../hooks/usePreciosCliente'
import { Compatibilidad } from '../ficha/Compatibilidad'
import { DatosProducto, Migas } from '../ficha/DatosProducto'
import { Galeria } from '../ficha/Galeria'
import { PreciosCliente } from '../ficha/PreciosCliente'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ErrorConReintento } from '../ErrorConReintento'
import { CabeceraSeo } from '../seo/CabeceraSeo'
import { productoJsonLd } from '../seo/datosEstructurados'

// Carga diferida (FR-012): los relacionados quedan fuera del primer pintado de la ficha.
const Relacionados = lazy(() => import('../ficha/Relacionados'))

// `/producto/:productoId` (F-TDA-13, FR-051/FR-056): ficha del producto de ESTA tienda. Inexistente,
// inactivo, oculto, de categoría oculta, de otra empresa o con un id inválido → la misma 404 amable.
// `/producto` sin id tampoco existe. El botón «Consultar por WhatsApp» (F-TDA-14, FR-020) usa el host y
// la empresa de ESTA tienda: sin número válido no aparece (y la ficha queda sin hueco).
export default function RutaProducto() {
  const { host, tienda } = useContextoTienda()
  const { productoId } = useParams()
  const ficha = useFichaProducto(host, productoId ?? '')
  const preciosCliente = usePreciosCliente(host, productoId ?? '')

  // Vista de producto (RF-TDA-24-2): una vez por ficha abierta, sin datos del visitante ni del producto.
  const idFichaAbierta = ficha.fase === 'lista' ? ficha.ficha.id : null
  useEffect(() => {
    if (idFichaAbierta) registrarEventoTienda('vista_producto')
  }, [idFichaAbierta])

  if (!productoId) return <PaginaNoEncontrada />
  if (ficha.fase === 'cargando') return <EstadoCargaPagina />
  if (ficha.fase === 'error') {
    return (
      <>
        {/* FR-004/FR-024: una pantalla de error no se indexa. */}
        <CabeceraSeo noindex pagina="No pudimos cargar el producto" />
        <ErrorConReintento titulo="No pudimos cargar el producto." alReintentar={ficha.reintentar} />
      </>
    )
  }
  if (ficha.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const { ficha: datos, urls } = ficha
  // La imagen de la ficha es una URL FIRMADA que vence (el bucket `productos-imagenes` es privado): no sirve para
  // Open Graph ni JSON-LD, que buscadores y redes guardan por días. Sin imagen estable, `CabeceraSeo` cae al logo
  // público de la tienda y el JSON-LD omite `image` (MSF-149).
  return (
    <Box>
      <CabeceraSeo
        host={host}
        pagina={datos.nombre}
        descripcion={datos.descripcion}
        ruta={`/producto/${datos.id}`}
        tipo="product"
        datosEstructurados={({ url }) => [
          productoJsonLd({ nombre: datos.nombre, descripcion: datos.descripcion, sku: datos.sku, imagen: null, url, precio: datos.precio, disponible: datos.disponible }),
        ]}
      />
      {/* Celular (F-TDA-17, FR-042): enlace de vuelta arriba; las migas son de escritorio. */}
      <Link component={EnlaceRuta} to="/catalogo" underline="hover" sx={{ display: { xs: 'inline-flex', md: 'none' }, alignItems: 'center', minHeight: (tema) => tema.spacing(5.5), mb: 1, color: 'inherit' }}>
        ← Todos los productos
      </Link>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}><Migas nombre={datos.nombre} /></Box>
      <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        <Galeria key={datos.id} imagenes={datos.imagenes} urls={urls} nombre={datos.nombre} />
        <Box>
          <DatosProducto ficha={datos} host={host} empresa={tienda.empresaNombre} />
          {preciosCliente ? <PreciosCliente precios={preciosCliente} /> : null}
          <Compatibilidad compatibilidad={datos.compatibilidad} />
        </Box>
      </Box>
      <Suspense fallback={null}>
        <Relacionados host={host} productoId={datos.id} />
      </Suspense>
    </Box>
  )
}
