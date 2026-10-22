import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Chip, Stack, TablePagination, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useCategorias } from '../../hooks/useCategorias'
import { supabaseClient } from '../../lib/supabase'
import { firmarImagenes } from '../../lib/productoImagenes'
import {
  CONSULTA_INICIAL,
  TAMANO_PAGINA_PRODUCTOS,
  consultarProductos,
  hayFiltrosActivos,
  type ColumnaOrdenProducto,
  type ConsultaProductos,
  type FilaProductoListado,
} from '../../lib/productosListado'
import { CambiarEstadoProducto } from '../../components/productos/CambiarEstadoProducto'
import { FiltrosListado } from '../../components/productos/FiltrosListado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { MiniaturaProducto } from '../../components/base/MiniaturaProducto'
import { infoDisponibilidad } from '../../lib/productos'
import { tokens } from '../../tema/tokens'

const ESPERA_BUSQUEDA_MS = 300
const COLUMNAS_ORDENABLES: ReadonlyArray<ColumnaOrdenProducto> = ['nombre', 'sku', 'activo']

type FilaProducto = FilaProductoListado & { imagen_url?: string | null }

// Precio, Costo y Margen quedan visibles con «—» hasta que lleguen Precios (MSF-114),
// Costo (MSF-179) y Rentabilidad (FR-002, Decisiones 4 y 5 de la spec). Stock ya muestra la disponibilidad.
const SIN_DATO = '—'
const columnaPendiente = (clave: string, encabezado: string): ColumnaAdaptable<FilaProducto> => ({
  clave,
  encabezado,
  align: 'right',
  render: () => <Typography variant="b" color="text.secondary">{SIN_DATO}</Typography>,
})

type EmpresaListado = { id: string; nombre: string }

// «Visible en» (F-CAT-07, FR-012): un chip por empresa, relleno si la vende y en contorno si no.
// `role="img"` + `aria-label` dicen el estado a los lectores de pantalla (no depende solo del relleno).
const columnaVisibleEn = (empresas: ReadonlyArray<EmpresaListado>): ColumnaAdaptable<FilaProducto> => ({
  clave: 'visible_en',
  encabezado: 'Visible en',
  render: (producto) =>
    empresas.length === 0 ? (
      <Typography variant="b" color="text.secondary">{SIN_DATO}</Typography>
    ) : (
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {empresas.map((empresa) => {
          const vende = producto.empresa_ids.includes(empresa.id)
          return (
            <Chip
              key={empresa.id}
              size="small"
              label={empresa.nombre}
              color={vende ? 'primary' : 'default'}
              variant={vende ? 'filled' : 'outlined'}
              role="img"
              aria-label={`${empresa.nombre}: ${vende ? 'se vende' : 'no se vende'}`}
            />
          )
        })}
      </Stack>
    ),
})

const columnasBase: ColumnaAdaptable<FilaProducto>[] = [
  {
    clave: 'nombre',
    encabezado: 'Producto',
    ordenable: true,
    render: (producto) => (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <MiniaturaProducto alt="" src={producto.imagen_url} />
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{producto.nombre}</Typography>
          <Typography variant="xs">{producto.sku ?? SIN_DATO}</Typography>
        </Stack>
      </Stack>
    ),
  },
  columnaPendiente('precio', 'Precio'),
  columnaPendiente('costo', 'Costo'),
  columnaPendiente('margen', 'Margen'),
  {
    // F-CAT-17 (FR-009): etiqueta de disponibilidad, derivada en la base. La cantidad numérica queda fuera de esta historia.
    clave: 'stock',
    encabezado: 'Stock',
    render: (producto) => {
      const info = infoDisponibilidad(producto.disponibilidad)
      return info ? <EtiquetaEstado texto={info.etiqueta} variante={info.variante} /> : <Typography variant="b" color="text.secondary">{SIN_DATO}</Typography>
    },
  },
  {
    clave: 'categoria',
    encabezado: 'Categoría',
    render: (producto) => <Typography variant="b" color={producto.categoria_ruta ? undefined : 'text.secondary'}>{producto.categoria_ruta ?? SIN_DATO}</Typography>,
  },
]

const columnaEstado: ColumnaAdaptable<FilaProducto> = {
    clave: 'activo',
    encabezado: 'Estado',
    ordenable: true,
    render: (producto) => <EtiquetaEstado texto={producto.activo ? 'Activo' : 'Inactivo'} variante={producto.activo ? 'exito' : 'neutral'} />,
}

// Listado de productos (F-CAT-01, FR-001…FR-008): búsqueda por nombre, SKU o código de barras, filtro Todos/Inactivos,
// orden por Producto/SKU/Estado y paginación, todo en el servidor sobre `v_productos_listado`.
// «Editar» y activar/desactivar solo para quien tiene edición en Productos; la autoridad es RLS.
export function ProductoList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('productos')
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  // Filtro de tienda (F-CAT-07, FR-013): sigue a la empresa activa de la barra superior y se resuelve
  // en el servidor; elegir otra tienda acá no cambia la empresa activa persistida.
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, hayError: errorEmpresas } = useFiltroPorEmpresaActiva()
  const [consultaBase, setConsulta] = useState<ConsultaProductos>(CONSULTA_INICIAL)
  // Al cambiar la tienda (desde acá o desde la barra superior) se vuelve a la página 1.
  const [empresaPrevia, setEmpresaPrevia] = useState(empresaId)
  if (empresaPrevia !== empresaId) {
    setEmpresaPrevia(empresaId)
    setConsulta((actual) => ({ ...actual, pagina: 1 }))
  }
  const { categorias, isLoading: cargandoCategorias, isError: errorCategorias } = useCategorias()
  // Si la categoría filtrada ya no existe (se eliminó), el filtro se descarta: el selector y la consulta no se desfasan.
  const categoriaId = !cargandoCategorias && !errorCategorias && consultaBase.categoriaId && !categorias.some((c) => c.id === consultaBase.categoriaId) ? null : consultaBase.categoriaId
  const consulta = useMemo<ConsultaProductos>(() => ({ ...consultaBase, empresaId, categoriaId }), [consultaBase, empresaId, categoriaId])
  const columnas = useMemo(() => [...columnasBase, columnaVisibleEn(empresas), columnaEstado], [empresas])
  const [textoEscrito, setTextoEscrito] = useState('')
  const [filas, setFilas] = useState<FilaProducto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  // Espera de tipeo: el texto se aplica a la consulta tras una pausa y vuelve a la página 1.
  useEffect(() => {
    const espera = setTimeout(() => {
      setConsulta((actual) => (actual.texto === textoEscrito ? actual : { ...actual, texto: textoEscrito, pagina: 1 }))
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [textoEscrito])

  // Enter (lector de códigos de barras): aplica el texto ya, sin la espera de tipeo. El campo no se
  // desmonta, así que conserva el foco para el siguiente escaneo.
  const buscarYa = () => setConsulta((actual) => (actual.texto === textoEscrito ? actual : { ...actual, texto: textoEscrito, pagina: 1 }))

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const resultado = await consultarProductos(supabaseClient, consulta)
      if (peticion !== ultimaPeticion.current) return
      // Si la página quedó fuera de rango, se vuelve a la primera.
      if (resultado.filas.length === 0 && consulta.pagina > 1) {
        setConsulta((actual) => ({ ...actual, pagina: 1 }))
        return
      }
      // Las imágenes viven en un bucket privado: se firman las del conjunto visible. Si falla la
      // firma, el listado se muestra igual con la miniatura vacía.
      const conRuta = resultado.filas.filter((fila) => fila.imagen_ruta)
      const firmadas = await firmarImagenes(
        supabaseClient,
        conRuta.map((fila) => ({ id: fila.id, posicion: 1, ruta: fila.imagen_ruta as string })),
      )
      if (peticion !== ultimaPeticion.current) return
      const urls = new Map(firmadas.map((imagen) => [imagen.id, imagen.url]))
      setFilas(resultado.filas.map((fila) => ({ ...fila, imagen_url: urls.get(fila.id) ?? null })))
      setTotal(resultado.total)
    } catch (error) {
      console.error('No pudimos cargar los productos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [consulta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hayFiltros = hayFiltrosActivos(consulta) || textoEscrito.trim() !== ''
  const limpiar = () => {
    setTextoEscrito('')
    setConsulta(CONSULTA_INICIAL)
    elegirEmpresa(null)
  }
  const ordenar = (clave: string) => {
    if (!COLUMNAS_ORDENABLES.includes(clave as ColumnaOrdenProducto)) return
    setConsulta((actual) => ({
      ...actual,
      columnaOrden: clave as ColumnaOrdenProducto,
      direccion: actual.columnaOrden === clave && actual.direccion === 'asc' ? 'desc' : 'asc',
      pagina: 1,
    }))
  }

  const catalogoVacio = filas !== null && filas.length === 0 && !hayFiltros

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
          ) : catalogoVacio ? (
            <EstadoVacio titulo="Todavía no hay productos cargados." />
          ) : (
            <>
              <FiltrosListado
                texto={textoEscrito}
                onTexto={setTextoEscrito}
                onBuscar={buscarYa}
                estado={consulta.estado}
                onEstado={(estado) => setConsulta((actual) => ({ ...actual, estado, pagina: 1 }))}
                columnaOrden={consulta.columnaOrden}
                direccion={consulta.direccion}
                onOrden={(columnaOrden, direccion) => setConsulta((actual) => ({ ...actual, columnaOrden, direccion, pagina: 1 }))}
                hayFiltros={hayFiltros}
                onLimpiar={limpiar}
                empresas={empresas}
                empresaId={empresaId}
                onEmpresa={(id) => {
                  elegirEmpresa(id)
                  setConsulta((actual) => ({ ...actual, pagina: 1 }))
                }}
                errorEmpresas={errorEmpresas}
                categorias={categorias}
                categoriaId={consulta.categoriaId}
                onCategoria={(categoriaId) => setConsulta((actual) => ({ ...actual, categoriaId, pagina: 1 }))}
                disponibilidad={consulta.disponibilidad}
                onDisponibilidad={(disponibilidad) => setConsulta((actual) => ({ ...actual, disponibilidad, pagina: 1 }))}
                contador={`${total} ${total === 1 ? 'producto' : 'productos'}`}
                ayuda="El catálogo es compartido: cada producto se publica en las tiendas que elijas. Un producto nuevo no está en ninguna tienda hasta que la marques: para verlo, elegí «Todas las tiendas»."
              />
              {filas.length === 0 ? (
                <EstadoVacio titulo="No hay productos que coincidan" descripcion="Probá con otra búsqueda o limpiá los filtros." />
              ) : (
                <ContenidoAdaptable
                  items={filas}
                  columnas={columnas}
                  obtenerClave={(producto) => producto.id}
                  etiquetaTabla="Productos"
                  orden={{ clave: consulta.columnaOrden, direccion: consulta.direccion }}
                  alOrdenar={ordenar}
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
              )}
              <TablePagination
                component="div"
                count={total}
                page={consulta.pagina - 1}
                rowsPerPage={TAMANO_PAGINA_PRODUCTOS}
                rowsPerPageOptions={[TAMANO_PAGINA_PRODUCTOS]}
                onPageChange={(_, nueva) => setConsulta((actual) => ({ ...actual, pagina: nueva + 1 }))}
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
