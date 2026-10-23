import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Autocomplete, Box, Button, Stack, TablePagination, TextField, Typography } from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { TAMANO_PAGINA_MOVIMIENTOS, useMovimientos, type Movimiento } from '../../hooks/useMovimientos'
import { ESTADOS_STOCK, type EstadoStock } from '../../lib/stock'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
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

const etiquetaProducto = (opcion: OpcionProducto) => (opcion.sku ? `${opcion.nombre} · ${opcion.sku}` : opcion.nombre)

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sin pasar por Date (evita el corrimiento de huso de un `date`).
const formatearFecha = (fecha: string) => fecha.split('-').reverse().join('/')

const formatearDiferencia = (diferencia: number) => (diferencia > 0 ? `+${diferencia}` : String(diferencia))

// Historial de movimientos (F-STK-03, FR-010/FR-012): solo lectura, paginado en servidor,
// con filtro por producto. Visible para lectura y edición (RequiereAccesoSeccion en la ruta);
// no ofrece ninguna acción de escritura, el historial es inmodificable.
const LIMITE_OPCIONES_PRODUCTO = 200

export function MovimientosStock() {
  const [productoId, setProductoId] = useState('')
  const [pagina, setPagina] = useState(1)
  const [productos, setProductos] = useState<OpcionProducto[]>([])
  const [errorProductos, setErrorProductos] = useState(false)
  const [resumen, setResumen] = useState<ResumenProducto[] | null>(null)
  const [errorResumen, setErrorResumen] = useState(false)
  const { movimientos, total, hayError, cargando, recargar } = useMovimientos({ productoId, pagina })

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

  // Página fuera de rango (p. ej. el historial cambió): se vuelve a la primera.
  useEffect(() => {
    if (movimientos !== null && movimientos.length === 0 && pagina > 1) setPagina(1)
  }, [movimientos, pagina])

  const columnas: ColumnaAdaptable<Movimiento>[] = [
    { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.producto_nombre ?? 'Producto no disponible'}</Typography>
          <Typography variant="xs">{fila.producto_sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    { clave: 'tipo', encabezado: 'Tipo', render: (fila) => <Typography variant="b">{ETIQUETA_TIPO[fila.tipo]}</Typography> },
    {
      clave: 'motivo',
      encabezado: 'Motivo / nota',
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
      align: 'right',
      render: (fila) => (
        <Stack spacing={0} alignItems="flex-end">
          <Typography variant="b">{fila.cantidad}</Typography>
          {fila.tipo === 'ajuste' ? <Typography variant="xs">{`Diferencia ${formatearDiferencia(fila.diferencia)}`}</Typography> : null}
        </Stack>
      ),
    },
    { clave: 'deposito', encabezado: 'Depósito', render: (fila) => <Typography variant="b">{fila.deposito_nombre ?? '—'}</Typography> },
    { clave: 'saldo', encabezado: 'Saldo', align: 'right', render: (fila) => <Typography variant="b">{fila.saldo}</Typography> },
    { clave: 'responsable', encabezado: 'Responsable', render: (fila) => <Typography variant="b">{fila.responsable ?? '—'}</Typography> },
  ]

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
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar el historial de movimientos." reintentar={() => void recargar()} />
          ) : movimientos === null || (movimientos.length === 0 && pagina > 1) ? (
            <EstadoCargaPagina />
          ) : movimientos.length === 0 ? (
            <EstadoVacio
              titulo={productoId ? 'Este producto todavía no tiene movimientos.' : 'Todavía no hay movimientos de stock.'}
              descripcion="Cuando registres entradas, salidas o ajustes, los vas a ver acá."
            />
          ) : (
            <Box aria-busy={cargando} sx={{ opacity: cargando ? 0.5 : 1, transition: 'opacity 150ms' }}>
              <ContenidoAdaptable
                items={movimientos}
                columnas={columnas}
                obtenerClave={(fila) => fila.id}
                etiquetaTabla="Historial de movimientos de stock"
              />
              <TablePagination
                component="div"
                count={total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA_MOVIMIENTOS}
                rowsPerPageOptions={[TAMANO_PAGINA_MOVIMIENTOS]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Movimientos por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              />
            </Box>
          )}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
