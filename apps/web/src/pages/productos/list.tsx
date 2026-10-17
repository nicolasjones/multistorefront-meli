import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Chip, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { supabaseClient } from '../../lib/supabase'
import { firmarImagenes } from '../../lib/productoImagenes'
import { CambiarEstadoProducto } from '../../components/productos/CambiarEstadoProducto'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const TAMANO_PAGINA = 25
const ESPERA_BUSQUEDA_MS = 300

type EstadoFiltro = 'todos' | 'activos' | 'inactivos'

type FilaProducto = {
  id: string
  nombre: string
  sku: string | null
  precio_lista: number
  moneda: string
  activo: boolean
  costo: number | null
  imagenUrl: string | null
}

// «Grilla mínima» (F-CAT-06) llevada al prototipo `design/pantallas/Productos.dc.html`
// con lo que tiene dueño: foto (producto_imagenes), precio, costo+margen (solo con
// lectura en Rentabilidad, la base lo exige igual), estado y buscador por nombre/SKU.
// Sin dueño y fuera del slice (MSF-160): stock, categorías, «Visible en», destacado,
// newsletter, ML, selección masiva, exportar/importar y borrado (la base no tiene DELETE).
const formatoMoneda = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

const formatearMonto = (monto: number) => `$ ${formatoMoneda.format(monto)}`

const formatearMargen = (precio: number, costo: number) =>
  `${(((precio - costo) / precio) * 100).toFixed(1).replace('.', ',')} %`

function ProductoMiniatura({ nombre, imagenUrl }: { nombre: string; imagenUrl: string | null }) {
  if (imagenUrl) {
    return <Box component="img" src={imagenUrl} alt="" sx={{ width: 40, height: 40, borderRadius: 2, border: '1px solid #EEEDE8', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <Box
      aria-hidden
      sx={{
        width: 40, height: 40, borderRadius: 2, flexShrink: 0,
        backgroundColor: '#F5F5F2', color: '#8A9099',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 18,
      }}
    >
      {nombre.trim().charAt(0).toUpperCase() || '·'}
    </Box>
  )
}

export function ProductoList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('productos')
  const { nivel: nivelRentabilidad, isLoading: cargandoRentabilidad } = useNivelSeccion('rentabilidad')
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const veCosto = !cargandoRentabilidad && (nivelRentabilidad === 'lectura' || nivelRentabilidad === 'edicion')
  const [filas, setFilas] = useState<FilaProducto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [estado, setEstado] = useState<EstadoFiltro>('todos')
  const [pagina, setPagina] = useState(1)
  const [hayError, setHayError] = useState(false)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const desde = (pagina - 1) * TAMANO_PAGINA
      let consulta = supabaseClient
        .schema('dominio')
        .from('productos')
        .select('id, nombre, sku, precio_lista, moneda, activo', { count: 'exact' })
      const buscado = textoAplicado.trim()
      if (buscado !== '') {
        // La coma y los paréntesis separan condiciones en el `or` de PostgREST y `%`/`_`
        // son comodines: se quitan para no romper la consulta ni cambiar su sentido.
        const patron = buscado.replace(/[%_,()]/g, '')
        consulta = consulta.or(`nombre.ilike.%${patron}%,sku.ilike.%${patron}%`)
      }
      if (estado === 'activos') consulta = consulta.eq('activo', true)
      if (estado === 'inactivos') consulta = consulta.eq('activo', false)
      const { data, error, count } = await consulta
        .order('nombre', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, desde + TAMANO_PAGINA - 1)
        .returns<Array<Omit<FilaProducto, 'costo' | 'imagenUrl'>>>()
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const base = data ?? []
      // Si la página quedó fuera de rango, se vuelve a la primera.
      if (base.length === 0 && pagina > 1) {
        setPagina(1)
        return
      }
      const costos = new Map<string, number>()
      if (veCosto && base.length > 0) {
        const { data: filasCosto, error: errorCosto } = await supabaseClient
          .schema('dominio')
          .from('producto_costos')
          .select('producto_id, costo')
          .in('producto_id', base.map((producto) => producto.id))
          .returns<Array<{ producto_id: string; costo: number }>>()
        if (errorCosto) throw errorCosto
        for (const fila of filasCosto ?? []) costos.set(fila.producto_id, fila.costo)
      }
      if (peticion !== ultimaPeticion.current) return
      let imagenes = new Map<string, string>()
      if (base.length > 0) {
        const { data: filasImagen, error: errorImagen } = await supabaseClient
          .schema('dominio')
          .from('producto_imagenes')
          .select('id, producto_id, posicion, ruta')
          .in('producto_id', base.map((producto) => producto.id))
          .order('posicion', { ascending: true })
          .returns<Array<{ id: string; producto_id: string; posicion: number; ruta: string }>>()
        if (errorImagen) throw errorImagen
        const primeras = new Map<string, { id: string; posicion: number; ruta: string }>()
        for (const fila of filasImagen ?? []) {
          if (!primeras.has(fila.producto_id)) {
            primeras.set(fila.producto_id, { id: fila.id, posicion: fila.posicion, ruta: fila.ruta })
          }
        }
        const firmadas = await firmarImagenes(supabaseClient, [...primeras.values()])
        imagenes = new Map<string, string>()
        for (const firmada of firmadas) {
          const fila = [...primeras.entries()].find(([, primera]) => primera.ruta === firmada.ruta)
          if (fila && firmada.url) imagenes.set(fila[0], firmada.url)
        }
      }
      if (peticion !== ultimaPeticion.current) return
      setFilas(base.map((producto) => ({
        ...producto,
        costo: costos.get(producto.id) ?? null,
        imagenUrl: imagenes.get(producto.id) ?? null,
      })))
      setTotal(count ?? 0)
    } catch (error) {
      console.error('No pudimos cargar los productos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [pagina, textoAplicado, estado, veCosto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const hayFiltros = textoAplicado.trim() !== '' || estado !== 'todos'

  const columnas: ColumnaAdaptable<FilaProducto>[] = [
    {
      clave: 'producto', encabezado: 'Producto',
      render: (producto) => (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <ProductoMiniatura nombre={producto.nombre} imagenUrl={producto.imagenUrl} />
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{producto.nombre}</span>
            <span style={{ color: '#5F6670', fontSize: 12 }}>{producto.sku ?? '—'}</span>
          </Stack>
        </Stack>
      ),
    },
    {
      clave: 'precio', encabezado: 'Precio',
      render: (producto) => (
        <Stack spacing={0} sx={{ textAlign: 'right' }}>
          <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatearMonto(producto.precio_lista)}</span>
          <span style={{ color: '#5F6670', fontSize: 12 }}>{producto.moneda}</span>
        </Stack>
      ),
    },
    ...(veCosto
      ? [
          {
            clave: 'costo', encabezado: 'Costo',
            render: (producto: FilaProducto) => (
              <span className="num" style={{ color: '#5F6670', fontVariantNumeric: 'tabular-nums' }}>
                {producto.costo === null ? '—' : formatearMonto(producto.costo)}
              </span>
            ),
          } satisfies ColumnaAdaptable<FilaProducto>,
          {
            clave: 'margen', encabezado: 'Margen',
            render: (producto: FilaProducto) => (
              producto.costo === null
                ? <span style={{ color: '#8A9099' }}>—</span>
                : <Chip
                    size="small"
                    color={((producto.precio_lista - producto.costo) / producto.precio_lista) * 100 < 10 ? 'warning' : 'success'}
                    label={formatearMargen(producto.precio_lista, producto.costo)}
                  />
            ),
          } satisfies ColumnaAdaptable<FilaProducto>,
        ]
      : []),
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (producto) => (
        <Chip size="small" color={producto.activo ? 'success' : 'default'} label={producto.activo ? 'Activo' : 'Inactivo'} />
      ),
    },
  ]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Productos"
        descripcion="Catálogo central: cada producto se muestra en las stores y canales que elijas."
        accion={puedeEditar ? <Button component={RouterLink} to="/productos/create" variant="contained">Nuevo producto</Button> : undefined}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <TextField
              type="search"
              label="Buscar productos"
              placeholder="Nombre o SKU"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ flex: 1, minWidth: 0 }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, valor: EstadoFiltro | null) => {
                if (valor === null) return
                setEstado(valor)
                setPagina(1)
              }}
            >
              <ToggleButton value="todos">Todos</ToggleButton>
              <ToggleButton value="activos">Activos</ToggleButton>
              <ToggleButton value="inactivos">Inactivos</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {errorEstado ? <Alert severity="error">{errorEstado}</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar los productos." reintentar={() => void cargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 && pagina === 1 ? (
            hayFiltros ? (
              <EstadoVacio titulo="No hay productos que coincidan." descripcion="Probá con otra búsqueda o quitá algún filtro." />
            ) : (
              <EstadoVacio titulo="Todavía no hay productos cargados." />
            )
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
              {filas.length > 0 ? <TablePagination
                component="div"
                count={total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA}
                rowsPerPageOptions={[TAMANO_PAGINA]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Productos por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              /> : null}
            </>
          )}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
