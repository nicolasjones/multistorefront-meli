import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, Snackbar, Stack, TablePagination, TextField, Typography,
} from '@mui/material'
import { avisoCatalogoTruncado, useBuscadorCatalogo } from '../../hooks/useBuscadorCatalogo'
import { supabaseClient } from '../../lib/supabase'
import { TAMANO_PAGINA_INGRESOS, useIngresos, type IngresoFila } from '../../hooks/useIngresos'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { AnularIngresoDialog, type IngresoAAnular } from './AnularIngresoDialog'

type ProveedorOpcion = { id: string; razon_social: string }
type EmpresaOpcion = { id: string; nombre: string }
type ProductoOpcion = { id: string; nombre: string; sku: string | null }
type OperadorOpcion = { actor_id: string; actor_nombre: string }

const MAXIMO_OPCIONES = 500

const formatearFecha = (fecha: string) => fecha.split('-').reverse().join('/')
const etiquetaProducto = (producto: ProductoOpcion) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

type Props = {
  // Cambia cuando se registra un ingreso para volver a leer el historial.
  revision: number
}

// Historial de ingresos (F-PRV-05): filtros por fechas, proveedor, empresa, producto y
// operador; paginación en servidor; estado de anulación visible. La RLS decide qué filas
// ve cada rol; el formulario de alta vive en la misma pantalla.
export function HistorialIngresos({ revision }: Props) {
  const [pagina, setPagina] = useState(1)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [productoId, setProductoId] = useState('')
  const [operadorId, setOperadorId] = useState('')

  const [proveedorElegido, setProveedorElegido] = useState<ProveedorOpcion | null>(null)
  const [productoElegido, setProductoElegido] = useState<ProductoOpcion | null>(null)
  const [proveedorAbierto, setProveedorAbierto] = useState(false)
  const [productoAbierto, setProductoAbierto] = useState(false)
  const proveedores = useBuscadorCatalogo<ProveedorOpcion>({
    tabla: 'proveedores', columnas: 'id, razon_social', columnasBusqueda: 'razon_social', orden: 'razon_social', habilitado: proveedorAbierto,
  })
  const productos = useBuscadorCatalogo<ProductoOpcion>({
    tabla: 'productos', columnas: 'id, nombre, sku', columnasBusqueda: 'nombre,sku', orden: 'nombre', habilitado: productoAbierto,
  })
  const [empresas, setEmpresas] = useState<EmpresaOpcion[]>([])
  const [operadores, setOperadores] = useState<OperadorOpcion[]>([])
  const [errorFiltros, setErrorFiltros] = useState(false)
  const [ingresoAAnular, setIngresoAAnular] = useState<IngresoAAnular | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const { nivel } = useNivelSeccion('stock')
  const puedeAnular = nivel === 'edicion'

  const { filas, total, hayError, cargando, recargar } = useIngresos({
    desde: desde || null,
    hasta: hasta || null,
    proveedorId: proveedorId || null,
    empresaId: empresaId || null,
    productoId: productoId || null,
    operadorId: operadorId || null,
    pagina,
    tamano: TAMANO_PAGINA_INGRESOS,
  })

  useEffect(() => {
    let vigente = true
    void (async () => {
      const [respuestaEmpresas, respuestaOperadores] = await Promise.all([
        supabaseClient.schema('dominio').from('empresas').select('id, nombre').order('nombre', { ascending: true }).limit(MAXIMO_OPCIONES).returns<EmpresaOpcion[]>(),
        supabaseClient.rpc('operadores_ingresos_mercaderia'),
      ])
      if (!vigente) return
      if (respuestaEmpresas.error || respuestaOperadores.error) {
        console.error('No pudimos cargar los filtros del historial de ingresos.', {
          empresas: respuestaEmpresas.error,
          operadores: respuestaOperadores.error,
        })
        setErrorFiltros(true)
        return
      }
      setEmpresas(respuestaEmpresas.data ?? [])
      setOperadores((respuestaOperadores.data ?? []) as unknown as OperadorOpcion[])
    })()
    return () => { vigente = false }
  }, [])

  useEffect(() => {
    if (revision > 0) void recargar()
  }, [revision, recargar])

  // Página fuera de rango (p. ej. al cambiar un filtro): se vuelve a la primera.
  useEffect(() => {
    if (filas !== null && filas.length === 0 && pagina > 1) setPagina(1)
  }, [filas, pagina])

  const cambiarFiltro = (aplicar: () => void) => {
    aplicar()
    setPagina(1)
  }

  const limpiarFiltros = () => {
    setDesde('')
    setHasta('')
    setProveedorId('')
    setEmpresaId('')
    setProductoId('')
    setOperadorId('')
    setPagina(1)
  }

  const hayFiltros = Boolean(desde || hasta || proveedorId || empresaId || productoId || operadorId)

  const columnas: ColumnaAdaptable<IngresoFila>[] = useMemo(() => [
    { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b">{fila.producto_nombre}</Typography>
          <Typography variant="xs">{fila.producto_sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    { clave: 'cantidad', encabezado: 'Cantidad', align: 'right', render: (fila) => <Typography variant="b">{`+${fila.cantidad}`}</Typography> },
    { clave: 'destino', encabezado: 'Destino', render: (fila) => <Typography variant="b">{fila.destino}</Typography> },
    { clave: 'empresa', encabezado: 'Tienda', render: (fila) => <Typography variant="b">{fila.empresa}</Typography> },
    { clave: 'proveedor', encabezado: 'Proveedor', render: (fila) => <Typography variant="b">{fila.proveedor}</Typography> },
    { clave: 'operador', encabezado: 'Operador', render: (fila) => <Typography variant="b">{fila.operador}</Typography> },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (fila) => (
        <Stack spacing={0.5} alignItems="flex-start">
          <Chip size="small" label={fila.estado === 'anulado' ? 'Anulado' : 'Registrado'} color={fila.estado === 'anulado' ? 'warning' : 'success'} variant="outlined" />
          {fila.estado === 'anulado' && fila.motivo_anulacion ? <Typography variant="xs">{fila.motivo_anulacion}</Typography> : null}
        </Stack>
      ),
    },
  ], [])

  const acciones = puedeAnular
    ? (fila: IngresoFila) => {
        // Una fila por producto: la anulación es del ingreso completo y se ofrece
        // una sola vez, en la primera línea que se muestra.
        const esPrimera = filas?.find((otra) => otra.ingreso_id === fila.ingreso_id) === fila
        if (!esPrimera || fila.estado !== 'registrado') return null
        return (
          <Button
            size="small"
            color="warning"
            onClick={() => setIngresoAAnular({ ingreso_id: fila.ingreso_id, proveedor: fila.proveedor, fecha: fila.fecha })}
          >
            Anular
          </Button>
        )
      }
    : undefined

  const proveedorActual = proveedorId !== '' ? proveedorElegido : null
  const productoActual = productoId !== '' ? productoElegido : null
  const conActual = <T extends { id: string }>(opciones: T[], actual: T | null) => (actual && !opciones.some((opcion) => opcion.id === actual.id) ? [actual, ...opciones] : opciones)
  const operadorActual = operadores.find((opcion) => opcion.actor_id === operadorId) ?? null

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" useFlexGap flexWrap="wrap">
        <Typography variant="h3" component="h2">Ingresos de mercadería</Typography>
        <Typography variant="xs">{total} {total === 1 ? 'línea' : 'líneas'}</Typography>
      </Stack>

      <BarraHerramientas ayuda="El historial no se edita: una corrección es una anulación con motivo.">
        <TextField
          size="small" type="date" label="Desde" value={desde}
          onChange={(evento) => cambiarFiltro(() => setDesde(evento.target.value))}
          slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }}
        />
        <TextField
          size="small" type="date" label="Hasta" value={hasta}
          onChange={(evento) => cambiarFiltro(() => setHasta(evento.target.value))}
          slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }}
        />
        <Autocomplete
          size="small" sx={{ width: 200 }} options={conActual(proveedores.opciones, proveedorActual)} value={proveedorActual}
          loading={proveedores.cargando} loadingText="Buscando proveedores…" filterOptions={(opciones) => opciones} onOpen={() => setProveedorAbierto(true)}
          onInputChange={(_, texto, motivo) => { if (motivo === 'input') proveedores.buscar(texto) }}
          getOptionLabel={(opcion) => opcion.razon_social}
          isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
          onChange={(_, nueva) => cambiarFiltro(() => { setProveedorElegido(nueva); setProveedorId(nueva?.id ?? ''); proveedores.buscar('') })}
          noOptionsText={proveedores.error ? 'No pudimos buscar proveedores. Probá de nuevo.' : 'Sin proveedores'}
          renderInput={(params) => <TextField {...params} label="Proveedor" error={proveedores.error} helperText={proveedores.error ? 'No pudimos buscar proveedores. Probá de nuevo.' : proveedores.truncado ? avisoCatalogoTruncado('proveedores') : undefined} />}
        />
        <FiltroEmpresa
          empresas={empresas}
          valor={empresaId === '' ? null : empresaId}
          onCambiar={(nuevo) => cambiarFiltro(() => setEmpresaId(nuevo ?? ''))}
        />
        <Autocomplete
          size="small" sx={{ width: 240 }} options={conActual(productos.opciones, productoActual)} value={productoActual}
          loading={productos.cargando} loadingText="Buscando productos…" filterOptions={(opciones) => opciones} onOpen={() => setProductoAbierto(true)}
          onInputChange={(_, texto, motivo) => { if (motivo === 'input') productos.buscar(texto) }}
          getOptionLabel={etiquetaProducto}
          isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
          onChange={(_, nueva) => cambiarFiltro(() => { setProductoElegido(nueva); setProductoId(nueva?.id ?? ''); productos.buscar('') })}
          noOptionsText={productos.error ? 'No pudimos buscar productos. Probá de nuevo.' : 'Sin productos'}
          renderInput={(params) => <TextField {...params} label="Producto" error={productos.error} helperText={productos.error ? 'No pudimos buscar productos. Probá de nuevo.' : productos.truncado ? avisoCatalogoTruncado('productos') : undefined} />}
        />
        <Autocomplete
          size="small" sx={{ width: 200 }} options={operadores} value={operadorActual}
          getOptionLabel={(opcion) => opcion.actor_nombre}
          isOptionEqualToValue={(opcion, valor) => opcion.actor_id === valor.actor_id}
          onChange={(_, nueva) => cambiarFiltro(() => setOperadorId(nueva?.actor_id ?? ''))}
          noOptionsText="Sin operadores"
          renderInput={(params) => <TextField {...params} label="Operador" />}
        />
        <Button onClick={limpiarFiltros} disabled={!hayFiltros}>Limpiar filtros</Button>
      </BarraHerramientas>

      {errorFiltros ? (
        <Typography variant="xs" color="error">No pudimos cargar todas las opciones de filtro; el historial sigue disponible.</Typography>
      ) : null}

      {hayError ? (
        <EstadoError descripcion="No pudimos cargar el historial de ingresos." reintentar={() => void recargar()} />
      ) : filas === null || (filas.length === 0 && pagina > 1) ? (
        <EstadoCargaPagina />
      ) : filas.length === 0 ? (
        <EstadoVacio
          titulo={hayFiltros ? 'No hay ingresos con esos filtros.' : 'Todavía no hay ingresos de mercadería.'}
          descripcion={hayFiltros ? 'Probá con otro rango de fechas o limpiá los filtros.' : 'Cuando registres el primero, lo vas a ver acá.'}
        />
      ) : (
        <Box aria-busy={cargando} sx={{ opacity: cargando ? 0.5 : 1, transition: 'opacity 150ms' }}>
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(fila) => `${fila.ingreso_id}-${fila.producto_id}`}
            acciones={acciones}
            etiquetaTabla="Historial de ingresos de mercadería"
          />
          <TablePagination
            component="div"
            count={total}
            page={pagina - 1}
            rowsPerPage={TAMANO_PAGINA_INGRESOS}
            rowsPerPageOptions={[TAMANO_PAGINA_INGRESOS]}
            onPageChange={(_, nueva) => setPagina(nueva + 1)}
            labelRowsPerPage="Líneas por página"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          />
        </Box>
      )}

      <AnularIngresoDialog
        abierto={ingresoAAnular !== null}
        ingreso={ingresoAAnular}
        onCerrar={() => setIngresoAAnular(null)}
        onAnulado={() => {
          setIngresoAAnular(null)
          setAviso('Ingreso anulado')
          void recargar()
        }}
      />
      <Snackbar open={aviso !== null} autoHideDuration={3000} onClose={() => setAviso(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setAviso(null)} variant="filled">{aviso}</Alert>
      </Snackbar>
    </Stack>
  )
}
