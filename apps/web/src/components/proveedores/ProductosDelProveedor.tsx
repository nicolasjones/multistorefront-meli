import { useState } from 'react'
import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useImagenesProductos } from '../../hooks/useImagenesProductos'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { type ProductoDeProveedor, useProductosDeProveedor } from '../../hooks/useProductosDeProveedor'
import { DialogoEvolucionCosto } from './DialogoEvolucionCosto'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { MiniaturaProducto } from '../base/MiniaturaProducto'
import { CargaInfinita } from '../pagina/CargaInfinita'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 10

const formatoCosto = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const columnaCosto: ColumnaAdaptable<ProductoDeProveedor> = {
  clave: 'costo',
  encabezado: 'Costo',
  align: 'right',
  render: (p) => (p.costo === null ? '—' : `${p.moneda} ${formatoCosto.format(p.costo)}`),
}

// La imagen principal llega aparte (`useImagenesProductos`) y se pasa por id.
const armarColumnas = (
  imagenes: ReadonlyMap<string, string>,
  alVerEvolucion: ((p: ProductoDeProveedor) => void) | null,
): ColumnaAdaptable<ProductoDeProveedor>[] => [
  {
    clave: 'nombre',
    encabezado: 'Producto',
    render: (p) => (
      <Stack direction="row" spacing={1} alignItems="center">
        <MiniaturaProducto alt="" src={imagenes.get(p.id)} />
        <span>
          {p.nombre}
          {p.activo ? null : <> <EtiquetaEstado texto="Inactivo" variante="aviso" /></>}
        </span>
      </Stack>
    ),
  },
  { clave: 'codigo', encabezado: 'Código del proveedor', render: (p) => p.codigo_proveedor ?? '—' },
  {
    clave: 'acciones',
    encabezado: 'Acciones',
    render: (p) => (
      <>
        <Button component={RouterLink} to={`/productos/${p.id}/edit`} size="small" aria-label={`Ver producto ${p.nombre}`}>
          Ver producto
        </Button>
        {alVerEvolucion ? (
          <Button size="small" onClick={() => alVerEvolucion(p)} aria-label={`Evolución del costo de ${p.nombre}`}>
            Evolución del costo
          </Button>
        ) : null}
      </>
    ),
  },
]

// Sección «Productos» de la ficha del proveedor (F-PRV-03, FR-018; Costo: MSF-528, solo con Rentabilidad; Evolución del costo: F-PRV-07). Se consulta aparte
// del resto de la ficha: un error o una carga lenta acá no la afectan. Ver producto
// abre su pantalla de edición (el catálogo no tiene ficha de solo lectura).
export function ProductosDelProveedor({ proveedorId }: { proveedorId: string }) {
  const [pagina, setPagina] = useState(1)
  const { nivel: nivelRentabilidad } = useNivelSeccion('rentabilidad')
  const veCosto = nivelRentabilidad === 'lectura' || nivelRentabilidad === 'edicion'
  const { nivel: nivelProveedores } = useNivelSeccion('proveedores')
  const veEvolucion = veCosto && (nivelProveedores === 'lectura' || nivelProveedores === 'edicion')
  const [productoEvolucion, setProductoEvolucion] = useState<ProductoDeProveedor | null>(null)
  const { productos, total, cargando, hayError, recargar } = useProductosDeProveedor(proveedorId, pagina, TAMANO_PAGINA)
  // Carga infinita: se suman las tandas de 10 que ya entrega `productos_de_proveedor`.
  const listado = useListadoAcumulado({ items: productos, pagina, setPagina, total, cargando, reinicio: proveedorId })
  // Si la tanda siguiente falló, «Reintentar» vuelve a pedir esa misma tanda (no salta a la siguiente).
  const falloTanda = hayError && pagina > 1
  const imagenes = useImagenesProductos(listado.filas.map((p) => p.id))
  const columnas = armarColumnas(imagenes, veEvolucion ? setProductoEvolucion : null)
  const columnasVisibles = veCosto ? [...columnas.slice(0, 2), columnaCosto, ...columnas.slice(2)] : columnas

  return (
    <Box component="section" aria-labelledby="titulo-productos-proveedor" aria-busy={cargando}>
      <Typography id="titulo-productos-proveedor" component="h2" variant="h6" sx={{ mb: 1 }}>Productos</Typography>
      {cargando && listado.filas.length === 0 ? (
        <EstadoCargaPagina />
      ) : hayError && !falloTanda ? (
        <EstadoError descripcion="No pudimos cargar los productos del proveedor." reintentar={() => void recargar()} />
      ) : listado.filas.length === 0 ? (
        <EstadoVacio titulo="Este proveedor todavía no tiene productos." />
      ) : (
        <>
          {cargando && pagina === 1 ? <LinearProgress aria-label="Actualizando productos" /> : null}
          <ContenidoAdaptable
            items={listado.filas}
            columnas={columnasVisibles}
            obtenerClave={(p) => p.id}
            etiquetaTabla="Productos del proveedor"
          />
          <CargaInfinita
            hayMas={listado.hayMas}
            cargando={listado.cargandoMas}
            hayError={falloTanda}
            onCargarMas={falloTanda ? () => void recargar() : listado.cargarMas}
          />
        </>
      )}
      {productoEvolucion ? (
        <DialogoEvolucionCosto open producto={productoEvolucion} onCerrar={() => setProductoEvolucion(null)} />
      ) : null}
    </Box>
  )
}
