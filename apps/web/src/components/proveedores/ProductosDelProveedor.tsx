import { useEffect, useState } from 'react'
import { Box, Button, LinearProgress, TablePagination, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { type ProductoDeProveedor, useProductosDeProveedor } from '../../hooks/useProductosDeProveedor'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 10

const columnas: ColumnaAdaptable<ProductoDeProveedor>[] = [
  {
    clave: 'nombre',
    encabezado: 'Producto',
    render: (p) => (
      <>
        {p.nombre}
        {p.activo ? null : <> <EtiquetaEstado texto="Inactivo" variante="aviso" /></>}
      </>
    ),
  },
  { clave: 'codigo', encabezado: 'Código del proveedor', render: (p) => p.codigo_proveedor ?? '—' },
  {
    clave: 'acciones',
    encabezado: 'Acciones',
    render: (p) => (
      <Button component={RouterLink} to={`/productos/${p.id}/edit`} size="small" aria-label={`Ver producto ${p.nombre}`}>
        Ver producto
      </Button>
    ),
  },
]

// Sección «Productos» de la ficha del proveedor (F-PRV-03, FR-018). Se consulta aparte
// del resto de la ficha: un error o una carga lenta acá no la afectan. Ver producto
// abre su pantalla de edición (el catálogo no tiene ficha de solo lectura).
export function ProductosDelProveedor({ proveedorId }: { proveedorId: string }) {
  const [pagina, setPagina] = useState(1)
  const { productos, total, cargando, hayError, recargar } = useProductosDeProveedor(proveedorId, pagina, TAMANO_PAGINA)

  // Si la página pedida quedó más allá del final, vuelve a la primera.
  useEffect(() => {
    if (!cargando && !hayError && pagina > 1 && productos.length === 0 && total === 0) setPagina(1)
  }, [cargando, hayError, pagina, productos.length, total])

  return (
    <Box component="section" aria-labelledby="titulo-productos-proveedor" aria-busy={cargando}>
      <Typography id="titulo-productos-proveedor" component="h2" variant="h6" sx={{ mb: 1 }}>Productos</Typography>
      {cargando && productos.length === 0 ? (
        <EstadoCargaPagina />
      ) : hayError ? (
        <EstadoError descripcion="No pudimos cargar los productos del proveedor." reintentar={() => void recargar()} />
      ) : productos.length === 0 ? (
        <EstadoVacio titulo="Este proveedor todavía no tiene productos." />
      ) : (
        <>
          {cargando ? <LinearProgress aria-label="Actualizando productos" /> : null}
          <ContenidoAdaptable
            items={productos}
            columnas={columnas}
            obtenerClave={(p) => p.id}
            etiquetaTabla="Productos del proveedor"
          />
          <TablePagination
            component="div" count={total} page={pagina - 1} rowsPerPage={TAMANO_PAGINA} rowsPerPageOptions={[TAMANO_PAGINA]}
            onPageChange={(_, nueva) => setPagina(nueva + 1)}
            labelRowsPerPage="Productos por página"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          />
        </>
      )}
    </Box>
  )
}
