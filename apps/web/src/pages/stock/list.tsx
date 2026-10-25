import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { ESTADOS_STOCK, filtroBusquedaStock, type EstadoStock } from '../../lib/stock'
import { listarDepositosActivos, listarStockPorDepositoDe, type DepositoOpcion, type StockPorDeposito } from '../../lib/depositos'
import { useExistenciasRealtime } from '../../lib/useExistenciasRealtime'
import { useExportarCsv } from '../../hooks/useExportarCsv'
import { nombreArchivoCsv } from '../../lib/exportarCsv'
import { ExportarCsvBoton } from '../../components/stock/ExportarCsvBoton'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import type { ColumnaCsv } from '../../lib/exportarCsv'
import { PestanasStock } from './PestanasStock'
import { tokens } from '../../tema/tokens'

// Los diálogos no pesan en el recorrido principal: se descargan al abrirlos (Principio VI).
const NuevoMovimientoDialog = lazy(() => import('./NuevoMovimientoDialog'))
const EditarMinimoDialog = lazy(() => import('./EditarMinimoDialog'))
const TrasladarDialog = lazy(() => import('./TrasladarDialog'))

const TAMANO_PAGINA = 25
// Lote chico: cada lote arma un `in (…)` con sus ids para las cifras por depósito.
const LOTE_EXPORTACION = 200
const nombreArchivoStock = () => nombreArchivoCsv('stock-actual')

type FilaStock = {
  producto_id: string
  nombre: string
  sku: string | null
  cantidad: number
  reservado: number
  disponible: number
  minimo: number
  estado: EstadoStock
  ultimo_movimiento_en: string | null
}

type FiltroEstado = 'todos' | 'alertas' | EstadoStock

const formatoFecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' })

const ultimoMovimiento = (valor: string | null) => (valor ? formatoFecha.format(new Date(valor)) : 'Sin movimientos')

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

type Cifras = { cantidad: number; reservado: number; disponible: number }

const etiquetaEstado = (estado: EstadoStock) => ESTADOS_STOCK.find((e) => e.valor === estado)?.etiqueta ?? estado

// Una sola declaración de columnas para la tabla y para el CSV (F-STK-08, FR-104): lo que se
// exporta es lo que se ve, con los mismos encabezados y orden, sin la columna de acciones.
const columnasStock = (cifrasDe: (fila: FilaStock) => Cifras): Array<ColumnaAdaptable<FilaStock> & ColumnaCsv<FilaStock>> => [
  {
    clave: 'producto',
    encabezado: 'Producto',
    valor: (fila) => (fila.sku ? `${fila.nombre} · ${fila.sku}` : fila.nombre),
    render: (fila) => (
      <Stack spacing={0}>
        <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.nombre}</Typography>
        <Typography variant="xs">{fila.sku ?? '—'}</Typography>
      </Stack>
    ),
  },
  { clave: 'cantidad', encabezado: 'Stock', align: 'right', valor: (fila) => cifrasDe(fila).cantidad, render: (fila) => <Typography variant="b">{cifrasDe(fila).cantidad}</Typography> },
  { clave: 'reservado', encabezado: 'Reservado', align: 'right', valor: (fila) => cifrasDe(fila).reservado, render: (fila) => <Typography variant="b">{cifrasDe(fila).reservado}</Typography> },
  { clave: 'disponible', encabezado: 'Disponible', align: 'right', valor: (fila) => cifrasDe(fila).disponible, render: (fila) => <Typography variant="b">{cifrasDe(fila).disponible}</Typography> },
  { clave: 'minimo', encabezado: 'Mínimo', align: 'right', valor: (fila) => fila.minimo, render: (fila) => <Typography variant="b">{fila.minimo}</Typography> },
  {
    clave: 'estado',
    encabezado: 'Estado',
    valor: (fila) => etiquetaEstado(fila.estado),
    render: (fila) => {
      const estado = ESTADOS_STOCK.find((e) => e.valor === fila.estado)
      return <EtiquetaEstado texto={estado?.etiqueta ?? fila.estado} variante={estado?.variante ?? 'neutral'} />
    },
  },
  { clave: 'ultimo', encabezado: 'Último movimiento', valor: (fila) => ultimoMovimiento(fila.ultimo_movimiento_en), render: (fila) => <Typography variant="s">{ultimoMovimiento(fila.ultimo_movimiento_en)}</Typography> },
]

// Stock actual (F-STK-02, FR-009; F-STK-05, FR-015): producto, SKU, cantidad, mínimo, estado y
// último movimiento, leídos de la vista `stock_estados`. Búsqueda por nombre o SKU, filtro por
// estado, resumen de reposición con «Ver solo alertas» y edición del mínimo / «Nuevo movimiento»
// solo para quien tiene edición en Stock; la autoridad es la base (RPC y RLS).
export function StockList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('stock')
  const { puedeEscribir } = usePuedeEscribir()
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const [filas, setFilas] = useState<FilaStock[] | null>(null)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<FiltroEstado>('todos')
  const [resumen, setResumen] = useState<{ sinStock: number; stockBajo: number } | null>(null)
  const [hayError, setHayError] = useState(false)
  // Control de depósito (D-4): «todos» muestra los totales únicos; un depósito, sus cifras.
  const [depositos, setDepositos] = useState<DepositoOpcion[]>([])
  const [depositoId, setDepositoId] = useState<'todos' | string>('todos')
  const [stockPorDeposito, setStockPorDeposito] = useState<Record<string, StockPorDeposito>>({})
  const [dialogo, setDialogo] = useState<{ abierto: boolean; productoId: string }>({ abierto: false, productoId: '' })
  const [edicionMinimo, setEdicionMinimo] = useState<FilaStock | null>(null)
  const [traslado, setTraslado] = useState<FilaStock | null>(null)
  const ultimaPeticion = useRef(0)

  const cargarResumen = useCallback(async () => {
    try {
      const contar = (estado: EstadoStock) =>
        supabaseClient.from('stock_estados').select('producto_id', { count: 'exact', head: true }).eq('estado', estado)
      const [sinStock, stockBajo] = await Promise.all([contar('sin_stock'), contar('stock_bajo')])
      if (sinStock.error) throw sinStock.error
      if (stockBajo.error) throw stockBajo.error
      setResumen({ sinStock: sinStock.count ?? 0, stockBajo: stockBajo.count ?? 0 })
    } catch (error) {
      // El resumen es un extra: si falla, el listado sigue; queda en consola.
      console.error('No pudimos calcular el resumen de reposición.', error)
      setResumen(null)
    }
  }, [])

  // Listado y exportación comparten consulta, filtros y orden (F-STK-08, FR-103/FR-107).
  const consultaStock = useCallback((conTotal: boolean) => {
    let consulta = supabaseClient
      .from('stock_estados')
      .select('producto_id, nombre, sku, cantidad, reservado, disponible, minimo, estado, ultimo_movimiento_en', conTotal ? { count: 'exact' } : {})
    if (filtro === 'alertas') consulta = consulta.in('estado', ['sin_stock', 'stock_bajo'])
    else if (filtro !== 'todos') consulta = consulta.eq('estado', filtro)
    const patron = filtroBusquedaStock(busqueda)
    if (patron) consulta = consulta.or(patron)
    return consulta
      .order('nombre', { ascending: true })
      .order('producto_id', { ascending: true })
  }, [busqueda, filtro])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const desde = (pagina - 1) * TAMANO_PAGINA
      const { data, error, count } = await consultaStock(true)
        .range(desde, desde + TAMANO_PAGINA - 1)
        .returns<FilaStock[]>()
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      // Si la página quedó fuera de rango, se vuelve a la primera.
      if ((data ?? []).length === 0 && pagina > 1) {
        setPagina(1)
        return
      }
      const filasCargadas = data ?? []
      setFilas(filasCargadas)
      setTotal(count ?? 0)
      if (depositoId !== 'todos' && filasCargadas.length > 0) {
        const porDeposito = await listarStockPorDepositoDe(filasCargadas.map((fila) => fila.producto_id), depositoId)
        if (peticion !== ultimaPeticion.current) return
        setStockPorDeposito(porDeposito)
      } else {
        setStockPorDeposito({})
      }
    } catch (error) {
      console.error('No pudimos cargar el stock.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [pagina, consultaStock, depositoId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    void cargarResumen()
  }, [cargarResumen])

  // Depósitos activos para el control (D-4). Si falla, el listado sigue con los totales.
  useEffect(() => {
    let vigente = true
    listarDepositosActivos()
      .then((opciones) => { if (vigente) setDepositos(opciones) })
      .catch((error) => console.error('No pudimos cargar los depósitos del control.', error))
    return () => { vigente = false }
  }, [])

  const refrescar = () => {
    void cargar()
    void cargarResumen()
  }

  // En vivo (F-STK-01, FR-010/011): cada aviso agrupado vuelve a pedir listado y resumen con la
  // búsqueda, el filtro y la página actuales; no se vacía la tabla, así que el foco no se mueve.
  useExistenciasRealtime(refrescar)

  const abrirDialogo = (productoId = '') => setDialogo({ abierto: true, productoId })
  const cambiarFiltro = (nuevo: FiltroEstado) => {
    setFiltro(nuevo)
    setPagina(1)
  }
  const hayFiltros = busqueda.trim() !== '' || filtro !== 'todos'
  const cifrasDe = (fila: FilaStock) => depositoId === 'todos'
    ? { cantidad: fila.cantidad, reservado: fila.reservado, disponible: fila.disponible }
    : stockPorDeposito[fila.producto_id] ?? { cantidad: 0, reservado: 0, disponible: 0 }
  const hayAlertas = resumen !== null && resumen.sinStock + resumen.stockBajo > 0
  const columnas = columnasStock(cifrasDe)

  // Exportar (F-STK-08): la misma consulta y filtros, todas las filas por lotes. Con un depósito
  // elegido, las cifras de cada lote se completan igual que en pantalla.
  const cifrasExportacion = useRef<Record<string, StockPorDeposito>>({})
  const columnasExportacion = useMemo(
    () => columnasStock((fila) => depositoId === 'todos'
      ? fila
      : cifrasExportacion.current[fila.producto_id] ?? { cantidad: 0, reservado: 0, disponible: 0 }),
    [depositoId],
  )
  const pedirLoteExportacion = useCallback(async (desde: number, limite: number) => {
    const { data, error } = await consultaStock(false).range(desde, desde + limite - 1).returns<FilaStock[]>()
    if (error) throw error
    return data ?? []
  }, [consultaStock])
  const completarLoteExportacion = useCallback(async (lote: FilaStock[]) => {
    if (depositoId !== 'todos' && lote.length > 0) {
      Object.assign(cifrasExportacion.current, await listarStockPorDepositoDe(lote.map((fila) => fila.producto_id), depositoId))
    }
    return lote
  }, [depositoId])
  const exportacion = useExportarCsv<FilaStock>({
    columnas: columnasExportacion,
    nombreArchivo: nombreArchivoStock,
    tamanoLote: LOTE_EXPORTACION,
    pedirLote: pedirLoteExportacion,
    completarLote: completarLoteExportacion,
  })

  return (
    <Box>
      <EncabezadoPagina
        titulo="Stock"
        accion={
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {puedeEscribir ? <Button component={RouterLink} to="/stock/motivos" variant="outlined">Motivos de movimiento</Button> : null}
            {puedeEditar ? <Button variant="contained" onClick={() => abrirDialogo()}>Nuevo movimiento</Button> : null}
          </Stack>
        }
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <PestanasStock activa="stock" />
        <Stack spacing={2}>
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar el stock." reintentar={() => void cargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 && !hayFiltros ? (
            <EstadoVacio titulo="Todavía no hay productos para llevar stock." descripcion="Cargá productos en el catálogo y acá vas a ver su stock." />
          ) : (
            <>
              {hayAlertas ? (
                <Alert
                  severity="warning"
                  action={
                    filtro === 'alertas' ? (
                      <Button color="inherit" onClick={() => cambiarFiltro('todos')}>Ver todos</Button>
                    ) : (
                      <Button color="inherit" onClick={() => cambiarFiltro('alertas')}>Ver solo alertas</Button>
                    )
                  }
                >
                  {plural(resumen.sinStock, 'producto sin stock', 'productos sin stock')} y {resumen.stockBajo} con stock bajo.
                </Alert>
              ) : null}
              <BarraHerramientas
                contador={`${total} ${total === 1 ? 'producto' : 'productos'}`}
                ayuda="El stock es único por organización y compartido entre empresas. El control de depósito cambia las cifras, no el estado (se calcula sobre el disponible total)."
              >
                {depositos.length > 0 ? (
                  <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 240 } }}>
                    <InputLabel id="deposito-stock">Depósito de mercadería</InputLabel>
                    <Select
                      labelId="deposito-stock"
                      label="Depósito de mercadería"
                      value={depositoId}
                      onChange={(evento) => setDepositoId(evento.target.value)}
                    >
                      <MenuItem value="todos">Todos los depósitos</MenuItem>
                      {depositos.map((deposito) => (
                        <MenuItem key={deposito.id} value={deposito.id}>
                          {deposito.nombre}{deposito.por_defecto ? ' (por defecto)' : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : null}
                <TextField
                  size="small"
                  label="Buscar por nombre o SKU"
                  value={busqueda}
                  onChange={(evento) => { setBusqueda(evento.target.value); setPagina(1) }}
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                />
                <ExportarCsvBoton {...exportacion} />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  aria-label="Filtrar por estado"
                  value={filtro === 'alertas' ? null : filtro}
                  onChange={(_, valor: FiltroEstado | null) => cambiarFiltro(valor ?? 'todos')}
                >
                  <ToggleButton value="todos">Todos</ToggleButton>
                  {ESTADOS_STOCK.map((estado) => <ToggleButton key={estado.valor} value={estado.valor}>{estado.etiqueta}</ToggleButton>)}
                </ToggleButtonGroup>
              </BarraHerramientas>
              {filas.length === 0 ? (
                <EstadoVacio titulo="Ningún producto coincide con la búsqueda o el filtro." />
              ) : (
                <ContenidoAdaptable
                  items={filas}
                  columnas={columnas}
                  obtenerClave={(fila) => fila.producto_id}
                  etiquetaTabla="Stock actual"
                  acciones={
                    puedeEditar
                      ? (fila) => (
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setEdicionMinimo(fila)} aria-label={`Editar mínimo de ${fila.nombre}`}>
                              Editar mínimo
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => abrirDialogo(fila.producto_id)} aria-label={`Nuevo movimiento de ${fila.nombre}`}>
                              Nuevo movimiento
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => setTraslado(fila)} aria-label={`Trasladar ${fila.nombre}`}>
                              Trasladar
                            </Button>
                          </Stack>
                        )
                      : undefined
                  }
                />
              )}
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
      {puedeEditar && dialogo.abierto ? (
        <Suspense fallback={null}>
          <NuevoMovimientoDialog
            abierto
            productoId={dialogo.productoId}
            onCerrar={() => setDialogo({ abierto: false, productoId: '' })}
            onRegistrado={refrescar}
          />
        </Suspense>
      ) : null}
      {puedeEditar && edicionMinimo ? (
        <Suspense fallback={null}>
          <EditarMinimoDialog
            producto={{ id: edicionMinimo.producto_id, nombre: edicionMinimo.nombre, minimo: edicionMinimo.minimo }}
            onCerrar={() => setEdicionMinimo(null)}
            onGuardado={refrescar}
          />
        </Suspense>
      ) : null}
      {puedeEditar && traslado ? (
        <Suspense fallback={null}>
          <TrasladarDialog
            producto={{ id: traslado.producto_id, nombre: traslado.nombre, sku: traslado.sku }}
            onCerrar={() => setTraslado(null)}
            onRegistrado={refrescar}
          />
        </Suspense>
      ) : null}
    </Box>
  )
}
