import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Chip, Stack, TablePagination } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { supabaseClient } from '../../lib/supabase'
import { CambiarEstadoProducto } from '../../components/productos/CambiarEstadoProducto'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const TAMANO_PAGINA = 25

type FilaProducto = { id: string; nombre: string; sku: string | null; activo: boolean }

const columnas: ColumnaAdaptable<FilaProducto>[] = [
  { clave: 'nombre', encabezado: 'Nombre', render: (producto) => producto.nombre },
  { clave: 'sku', encabezado: 'SKU', render: (producto) => producto.sku ?? '—' },
  {
    clave: 'estado',
    encabezado: 'Estado',
    render: (producto) => (
      <Chip size="small" color={producto.activo ? 'success' : 'default'} label={producto.activo ? 'Activo' : 'Inactivo'} />
    ),
  },
]

// Grilla mínima de solo lectura (F-CAT-06, FR-015, Decisión 3): nombre, SKU y estado,
// con «Editar» y activar/desactivar solo para quien tiene edición en Productos.
// La autoridad es RLS; los productos inactivos se siguen listando, marcados «Inactivo».
export function ProductoList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('productos')
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const [filas, setFilas] = useState<FilaProducto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [hayError, setHayError] = useState(false)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const desde = (pagina - 1) * TAMANO_PAGINA
      const { data, error, count } = await supabaseClient
        .schema('dominio')
        .from('productos')
        .select('id, nombre, sku, activo', { count: 'exact' })
        .order('nombre', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, desde + TAMANO_PAGINA - 1)
        .returns<FilaProducto[]>()
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      // Si la página quedó fuera de rango, se vuelve a la primera.
      if ((data ?? []).length === 0 && pagina > 1) {
        setPagina(1)
        return
      }
      setFilas(data ?? [])
      setTotal(count ?? 0)
    } catch (error) {
      console.error('No pudimos cargar los productos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Box>
      <EncabezadoPagina
        titulo="Productos"
        accion={puedeEditar ? <Button component={RouterLink} to="/productos/create" variant="contained">Nuevo producto</Button> : undefined}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {errorEstado ? <Alert severity="error">{errorEstado}</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar los productos." reintentar={() => void cargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 ? (
            <EstadoVacio titulo="Todavía no hay productos cargados." />
          ) : (
            <>
              <ContenidoAdaptable
                items={filas}
                columnas={columnas}
                obtenerClave={(producto) => producto.id}
                etiquetaTabla="Productos"
                acciones={
                  puedeEditar
                    ? (producto) => (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Button component={RouterLink} to={`/productos/${producto.id}/edit`} aria-label={`Editar ${producto.nombre}`}>Editar</Button>
                          <CambiarEstadoProducto
                            id={producto.id}
                            nombre={producto.nombre}
                            activo={producto.activo}
                            onCambiado={() => void cargar()}
                            onError={setErrorEstado}
                          />
                        </Stack>
                      )
                    : undefined
                }
              />
              <TablePagination
                component="div"
                count={total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA}
                rowsPerPageOptions={[TAMANO_PAGINA]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Productos por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              />
            </>
          )}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
