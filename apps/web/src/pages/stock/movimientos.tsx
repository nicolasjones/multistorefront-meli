import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Autocomplete, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { useMovimientos, type Movimiento } from '../../hooks/useMovimientos'
import { useExportarCsv } from '../../hooks/useExportarCsv'
import { nombreArchivoCsv, type ColumnaCsv } from '../../lib/exportarCsv'
import { ExportarCsvBoton } from '../../components/stock/ExportarCsvBoton'
import { ESTADOS_STOCK, type EstadoStock } from '../../lib/stock'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { MiniaturaProducto } from '../../components/base/MiniaturaProducto'
import { renderOpcionProducto } from '../../components/base/OpcionProducto'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { useImagenesProductos } from '../../hooks/useImagenesProductos'
import { PestanasStock } from './PestanasStock'
import { tokens } from '../../tema/tokens'

type OpcionProducto = { id: string; nombre: string; sku: string | null }

const ETIQUETA_TIPO: Record<Movimiento['tipo'], string> = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste' }

type ResumenProducto = {
  producto_id: string
  nombre: string
  sku: string | null
  cantidad: number
  reservado: number
  disponible: number
  estado: EstadoStock
}

const LIMITE_RESUMEN = 200
const SIN_FILAS: Movimiento[] = []

const etiquetaProducto = (opcion: OpcionProducto) => (opcion.sku ? `${opcion.nombre} · ${opcion.sku}` : opcion.nombre)

const etiquetaProductoMovimiento = (fila: Movimiento) => {
  const nombre = fila.producto_nombre ?? 'Producto no disponible'
  return fila.producto_sku ? `${nombre} · ${fila.producto_sku}` : nombre
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sin pasar por Date (evita el corrimiento de huso de un `date`).
// Los dos movimientos de un traslado (F-STK-15, FR-026) se rotulan «Traslado · Salida/Entrada».
const etiquetaTipo = (fila: Movimiento) => (fila.traslado_id ? `Traslado · ${ETIQUETA_TIPO[fila.tipo]}` : ETIQUETA_TIPO[fila.tipo])

const formatearFecha = (fecha: string) => fecha.split('-').reverse().join('/')

const formatearDiferencia = (diferencia: number) => (diferencia > 0 ? `+${diferencia}` : String(diferencia))

// Una sola declaración de columnas para la tabla y para el CSV (F-STK-08, FR-104): lo que se
// exporta es lo que se ve, con los mismos encabezados y orden, sin acciones.
const columnasMovimientos = (imagenes: ReadonlyMap<string, string> = new Map()): Array<ColumnaAdaptable<Movimiento> & ColumnaCsv<Movimiento>> => [
  { clave: 'fecha', encabezado: 'Fecha', valor: (fila) => formatearFecha(fila.fecha), render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
  {
    clave: 'producto',
    encabezado: 'Producto',
    valor: (fila) => etiquetaProductoMovimiento(fila),
    render: (fila) => (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <MiniaturaProducto alt="" src={imagenes.get(fila.producto_id)} />
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.producto_nombre ?? 'Producto no disponible'}</Typography>
          <Typography variant="xs">{fila.producto_sku ?? '—'}</Typography>
        </Stack>
      </Stack>
    ),
  },
  { clave: 'tipo', encabezado: 'Tipo', valor: etiquetaTipo, render: (fila) => <Typography variant="b">{etiquetaTipo(fila)}</Typography> },
  {
    clave: 'motivo',
    encabezado: 'Motivo / nota',
    valor: (fila) => [fila.motivo, fila.nota].filter(Boolean).join(' · ') || null,
    render: (fila) => (
      <Stack spacing={0}>
        <Typography variant="b">{fila.motivo ?? '—'}</Typography>
        {fila.nota ? <Typography variant="xs">{fila.nota}</Typography> : null}
      </Stack>
    ),
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    valor: (fila) => fila.cantidad,
    align: 'right',
    render: (fila) => (
      <Stack spacing={0} alignItems="flex-end">
        <Typography variant="b">{fila.cantidad}</Typography>
        {fila.tipo === 'ajuste' ? <Typography variant="xs">{`Diferencia ${formatearDiferencia(fila.diferencia)}`}</Typography> : null}
      </Stack>
    ),
  },
  { clave: 'deposito', encabezado: 'Depósito', valor: (fila) => fila.deposito_nombre, render: (fila) => <Typography variant="b">{fila.deposito_nombre ?? '—'}</Typography> },
  { clave: 'saldo', encabezado: 'Saldo', valor: (fila) => fila.saldo, align: 'right', render: (fila) => <Typography variant="b">{fila.saldo}</Typography> },
  { clave: 'responsable', encabezado: 'Responsable', valor: (fila) => fila.responsable, render: (fila) => <Typography variant="b">{fila.responsable ?? '—'}</Typography> },
]

const COLUMNAS_EXPORTACION = columnasMovimientos()

// Historial de movimientos (F-STK-03, FR-010/FR-012): solo lectura, carga infinita sobre el RPC paginado,
// con filtro por producto. Visible para lectura y edición (RequiereAccesoSeccion en la ruta);
// no ofrece ninguna acción de escritura, el historial es inmodificable.
const LIMITE_OPCIONES_PRODUCTO = 200

// `listar_movimientos_stock` topa cada pedido en 100 filas.
const LOTE_EXPORTACION = 100
const nombreArchivoMovimientos = () => nombreArchivoCsv('movimientos-stock')

export function MovimientosStock() {
  const [productoId, setProductoId] = useState('')
  const [pagina, setPagina] = useState(1)
  const [productos, setProductos] = useState<OpcionProducto[]>([])
  const [errorProductos, setErrorProductos] = useState(false)
  const [resumen, setResumen] = useState<ResumenProducto[] | null>(null)
  const [errorResumen, setErrorResumen] = useState(false)
  const { movimientos, total, hayError, cargando, recargar } = useMovimientos({ productoId, pagina })

  // Exportar (F-STK-08): la misma consulta del historial con el filtro de producto, sin paginar.
  const pedirLoteExportacion = useCallback(async (desde: number, limite: number) => {
    const { data, error } = await supabaseClient.rpc('listar_movimientos_stock', {
      p_producto: productoId || null,
      p_limite: limite,
      p_desplazamiento: desde,
    })
    if (error) throw error
    return (data ?? []) as unknown as Movimiento[]
  }, [productoId])
  const exportacion = useExportarCsv<Movimiento>({
    columnas: COLUMNAS_EXPORTACION,
    nombreArchivo: nombreArchivoMovimientos,
    tamanoLote: LOTE_EXPORTACION,
    pedirLote: pedirLoteExportacion,
  })

  // Opciones del filtro: si la persona no ve Catálogo, el filtro queda sin opciones y el
  // historial sigue funcionando completo.
  useEffect(() => {
    let vigente = true
    void (async () => {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('productos')
        .select('id, nombre, sku')
        .order('nombre', { ascending: true })
        .limit(LIMITE_OPCIONES_PRODUCTO)
        .returns<OpcionProducto[]>()
      if (!vigente) return
      if (error) {
        console.error('No pudimos cargar los productos del filtro.', error)
        setErrorProductos(true)
      } else setProductos(data ?? [])
    })()
    return () => {
      vigente = false
    }
  }, [])

  // Resumen por producto (FR-012): Queda, Reserv. y Disp. sobre el disponible total.
  const ultimaPeticionResumen = useRef(0)
  const cargarResumen = useCallback(async () => {
    const peticion = ++ultimaPeticionResumen.current
    setErrorResumen(false)
    let consulta = supabaseClient
      .from('stock_estados')
      .select('producto_id, nombre, sku, cantidad, reservado, disponible, estado')
    if (productoId) consulta = consulta.eq('producto_id', productoId)
    const { data, error } = await consulta
      .order('nombre', { ascending: true })
      .limit(LIMITE_RESUMEN)
      .returns<ResumenProducto[]>()
    if (peticion !== ultimaPeticionResumen.current) return
    if (error) {
      console.error('No pudimos cargar el resumen por producto.', error)
      setErrorResumen(true)
      return
    }
    setResumen(data ?? [])
  }, [productoId])

  useEffect(() => {
    void cargarResumen()
  }, [cargarResumen])

  const listado = useListadoAcumulado({ items: movimientos ?? SIN_FILAS, pagina, setPagina, total, cargando, reinicio: productoId })
  const imagenes = useImagenesProductos(listado.filas.map((fila) => fila.producto_id))
  // Imágenes de las opciones solo mientras el desplegable está abierto (el catálogo puede ser largo).
  const [desplegableAbierto, setDesplegableAbierto] = useState(false)
  const imagenesOpciones = useImagenesProductos(desplegableAbierto ? productos.map((opcion) => opcion.id) : [])
  const columnas = useMemo(() => columnasMovimientos(imagenes), [imagenes])
  const falloTanda = hayError && pagina > 1

  const opcionActual = productos.find((opcion) => opcion.id === productoId) ?? null

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="movimientos" />
        <Stack spacing={2}>
          <BarraHerramientas
            contador={movimientos !== null && !hayError ? `${total} ${total === 1 ? 'movimiento' : 'movimientos'}` : undefined}
            ayuda="El historial es de solo lectura: los movimientos no se pueden editar ni borrar."
          >
            <Autocomplete
              size="small"
              sx={{ minWidth: { xs: '100%', sm: 320 } }}
              options={productos}
              value={opcionActual}
              getOptionLabel={etiquetaProducto}
              onOpen={() => setDesplegableAbierto(true)}
              onClose={() => setDesplegableAbierto(false)}
              renderOption={renderOpcionProducto<OpcionProducto>(imagenesOpciones)}
              isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
              onChange={(_, nueva) => {
                setProductoId(nueva?.id ?? '')
                setPagina(1)
              }}
              noOptionsText="No hay productos"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Filtrar por producto"
                  error={errorProductos}
                  helperText={
                    errorProductos
                      ? 'No pudimos cargar los productos para filtrar. Recargá la página para reintentar.'
                      : productos.length >= LIMITE_OPCIONES_PRODUCTO
                        ? `Se listan los primeros ${LIMITE_OPCIONES_PRODUCTO} productos por nombre.`
                        : undefined
                  }
                />
              )}
            />
            <ExportarCsvBoton {...exportacion} />
          </BarraHerramientas>
          {errorResumen ? (
            <Alert severity="warning" action={<Button size="small" onClick={() => void cargarResumen()}>Reintentar</Button>}>
              No pudimos cargar el resumen por producto.
            </Alert>
          ) : resumen !== null && resumen.length > 0 ? (
            <Box>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Resumen por producto</Typography>
              {resumen.length >= LIMITE_RESUMEN && !productoId && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  Se listan los primeros {LIMITE_RESUMEN} productos por nombre. Filtrá por producto para ver uno puntual.
                </Alert>
              )}
              <ContenidoAdaptable
                items={resumen}
                columnas={[
                  { clave: 'producto', encabezado: 'Producto', render: (fila) => <Typography variant="b">{fila.nombre}</Typography> },
                  { clave: 'cantidad', encabezado: 'Queda', align: 'right', render: (fila) => <Typography variant="b">{fila.cantidad}</Typography> },
                  { clave: 'reservado', encabezado: 'Reserv.', align: 'right', render: (fila) => <Typography variant="b">{fila.reservado}</Typography> },
                  { clave: 'disponible', encabezado: 'Disp.', align: 'right', render: (fila) => <Typography variant="b">{fila.disponible}</Typography> },
                  {
                    clave: 'estado',
                    encabezado: 'Estado',
                    render: (fila) => {
                      const estado = ESTADOS_STOCK.find((e) => e.valor === fila.estado)
                      return <EtiquetaEstado texto={estado?.etiqueta ?? fila.estado} variante={estado?.variante ?? 'neutral'} />
                    },
                  },
                ]}
                obtenerClave={(fila) => fila.producto_id}
                etiquetaTabla="Resumen por producto"
              />
            </Box>
          ) : null}
          {hayError && !falloTanda ? (
            <EstadoError descripcion="No pudimos cargar el historial de movimientos." reintentar={() => void recargar()} />
          ) : movimientos === null ? (
            <EstadoCargaPagina />
          ) : listado.filas.length === 0 ? (
            <EstadoVacio
              titulo={productoId ? 'Este producto todavía no tiene movimientos.' : 'Todavía no hay movimientos de stock.'}
              descripcion="Cuando registres entradas, salidas o ajustes, los vas a ver acá."
            />
          ) : (
            <Box aria-busy={cargando} sx={{ opacity: cargando && pagina === 1 ? 0.5 : 1, transition: 'opacity 150ms' }}>
              <ContenidoAdaptable
                items={listado.filas}
                columnas={columnas}
                obtenerClave={(fila) => fila.id}
                etiquetaTabla="Historial de movimientos de stock"
              />
              <CargaInfinita
                hayMas={listado.hayMas}
                cargando={listado.cargandoMas}
                hayError={falloTanda}
                onCargarMas={falloTanda ? () => void recargar() : listado.cargarMas}
              />
            </Box>
          )}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
