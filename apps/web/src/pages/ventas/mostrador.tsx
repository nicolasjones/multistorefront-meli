import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useListarCuentasCobro } from '../../hooks/useListarCuentasCobro'
import { formatearImporteHistorial } from '../../lib/formatoHistorial'
import type { Comprobante } from '../../lib/ventas'
import { rotuloEscalaLinea } from '../../lib/ventasLineas'
import { etiquetaCuentaCobro } from '../../lib/ventas/cuentasCobro'
import { puedeRegistrarCobro, registrarCobro } from '../../lib/ventas/cobros'
import { confirmarComprobante } from '../../lib/ventasConfirmacion'
import { listarFormasPago, type FormaPago } from '../../lib/ventas/formasPago'
import {
  MENSAJE_PRODUCTO_NO_ENCONTRADO, MENSAJE_SIN_CONSUMIDOR_FINAL, agregarProductoAVenta, buscarProductoPorCodigoBarras,
  esEan13, mensajeDeCobroVenta, mensajeDeConfirmarVenta, mensajeDeEscaneo, mensajeDescarteVenta, obtenerConsumidorFinal,
  MENSAJE_CODIGO_INVALIDO,
} from '../../lib/ventasMostrador'
import { LectorCodigoBarras } from '../../components/ventas/LectorCodigoBarras'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

export const TITULO_MOSTRADOR = 'Venta de mostrador'

export const MENSAJE_SIN_TIENDA_ACTIVA = 'Elegí una tienda en la barra superior para escanear.'
export const MENSAJE_ERROR_FORMAS_PAGO = 'No pudimos cargar las formas de pago de esta tienda. Probá de nuevo.'

// Venta de mostrador con lector de código de barras (F-VTA-31, MSF-329; FR-002…FR-005). La venta en curso es una
// factura `borrador` (canal Mostrador, Consumidor final, empresa activa) que se crea al primer escaneo. La base
// calcula precios y totales. Al cambiar la empresa activa la venta en curso se descarta con aviso (Principio VIII).
export function VentaMostrador() {
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas, refetch } = useEmpresasAccesibles()
  const [venta, setVentaEstado] = useState<Comprobante | null>(null)
  const [errorEscaneo, setErrorEscaneo] = useState<string | null>(null)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)
  const [errorFormas, setErrorFormas] = useState<string | null>(null)
  const [avisoDescarte, setAvisoDescarte] = useState<string | null>(null)
  const [cobrada, setCobrada] = useState<{ numero: string; total: number } | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [confirmadaId, setConfirmadaId] = useState<string | null>(null)
  const [formas, setFormas] = useState<FormaPago[]>([])
  const [formaId, setFormaId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [puedeCobrar, setPuedeCobrar] = useState(true)
  // La venta en curso y el cliente por defecto se leen también desde refs: un escaneo en vuelo (o en cola) tiene
  // que usar el valor más reciente, no el del render en el que se encoló.
  const ventaRef = useRef<Comprobante | null>(null)
  const clienteRef = useRef<string | null>(null)
  // Códigos leídos mientras otro se resolvía: el lector USB tipea el siguiente al instante. Antes se descartaban
  // en silencio y la venta quedaba con el total corto (FR-002).
  const pendientes = useRef<Array<{ codigo: string; empresa: string }>>([])
  const enVuelo = useRef(false)
  // Empresa vigente para descartar respuestas que llegan después de cambiar de tienda.
  const empresaVigente = useRef<string | null>(null)
  useEffect(() => {
    empresaVigente.current = empresaActivaId
  }, [empresaActivaId])

  const setVenta = useCallback((valor: Comprobante | null) => {
    ventaRef.current = valor
    setVentaEstado(valor)
  }, [])

  // La venta de otra tienda no se muestra ni se cobra bajo la nueva (derivado, sin efecto).
  const ventaVigente = venta && venta.empresa_id === empresaActivaId ? venta : null
  const ventaDeOtraTienda = venta && venta.empresa_id !== empresaActivaId ? venta : null
  const descarte = avisoDescarte ?? (ventaDeOtraTienda ? mensajeDescarteVenta(ventaDeOtraTienda.empresa) : null)
  const exigeCuenta = formas.find((forma) => forma.id === formaId)?.exige_cuenta_cobro === true
  const cuentas = useListarCuentasCobro({ empresaId: empresaActivaId, estado: 'activas', pagina: 1, tamano: 200 })

  useEffect(() => {
    if (!empresaActivaId) return
    let vigente = true
    Promise.all([listarFormasPago(empresaActivaId), puedeRegistrarCobro(empresaActivaId)])
      .then(([lista, puede]) => {
        if (!vigente) return
        const activas = lista.filter((forma) => forma.activo)
        setFormas(activas)
        setFormaId((actual) => (activas.some((forma) => forma.id === actual) ? actual : (activas[0]?.id ?? '')))
        setCuentaId('')
        setPuedeCobrar(puede)
        setErrorFormas(null)
      })
      .catch((error) => {
        if (!vigente) return
        console.error('No se pudieron cargar las formas de pago del mostrador', error instanceof Error ? error.message : error)
        setFormas([])
        setFormaId('')
        // El fallo se avisa: si no, la pantalla parecía que la tienda no tiene formas de pago.
        setErrorFormas(MENSAJE_ERROR_FORMAS_PAGO)
      })
    return () => {
      vigente = false
    }
  }, [empresaActivaId])

  // Procesa un código: resuelve el producto y lo agrega a la venta en curso (FR-002).
  const procesar = useCallback(async (codigo: string, empresa: string) => {
    setErrorEscaneo(null)
    setErrorVenta(null)
    if (!esEan13(codigo)) {
      setErrorEscaneo(MENSAJE_CODIGO_INVALIDO)
      return
    }
    try {
      const producto = await buscarProductoPorCodigoBarras(codigo)
      if (!producto) {
        setErrorEscaneo(MENSAJE_PRODUCTO_NO_ENCONTRADO)
        return
      }
      let cliente = clienteRef.current
      if (!cliente) {
        cliente = await obtenerConsumidorFinal()
        if (!cliente) {
          setErrorEscaneo(MENSAJE_SIN_CONSUMIDOR_FINAL)
          return
        }
        clienteRef.current = cliente
      }
      const actual = ventaRef.current
      const base = actual && actual.empresa_id === empresa ? actual : null
      const actualizada = await agregarProductoAVenta(base, empresa, cliente, producto.producto_id)
      if (empresaVigente.current === empresa) {
        setVenta(actualizada)
        setAvisoDescarte(null)
      } else {
        // Cambió la tienda mientras se resolvía: esa venta no se muestra ni se cobra bajo la nueva, y se avisa
        // que se descartó (Principio VIII).
        setAvisoDescarte(mensajeDescarteVenta(actualizada.empresa))
      }
    } catch (error) {
      setErrorEscaneo(mensajeDeEscaneo(error))
    }
  }, [setVenta])

  // Escaneo (FR-002): el lector USB tipea el código y envía Enter. Si llega otro código mientras el anterior
  // todavía se resuelve, se encola (con la tienda en la que se leyó) y se procesa en orden: no se pierde ninguno.
  const escanear = useCallback(async (codigo: string) => {
    if (!empresaActivaId) {
      setErrorEscaneo(MENSAJE_SIN_TIENDA_ACTIVA)
      return
    }
    pendientes.current.push({ codigo, empresa: empresaActivaId })
    if (enVuelo.current) return
    enVuelo.current = true
    try {
      while (pendientes.current.length > 0) {
        const pendiente = pendientes.current.shift()
        if (!pendiente) break
        await procesar(pendiente.codigo, pendiente.empresa)
      }
    } finally {
      enVuelo.current = false
    }
  }, [empresaActivaId, procesar])

  async function cobrar() {
    if (!ventaVigente || cobrando) return
    setCobrando(true)
    setErrorVenta(null)
    let fase: 'confirmar' | 'cobrar' = 'confirmar'
    try {
      // Si el cobro falló tras confirmar, el reintento no vuelve a confirmar ni duplica la venta.
      if (confirmadaId !== ventaVigente.id) {
        await confirmarComprobante(ventaVigente.id)
        setConfirmadaId(ventaVigente.id)
      }
      fase = 'cobrar'
      await registrarCobro(ventaVigente.id, {
        forma_pago_id: formaId,
        cuenta_cobro_id: exigeCuenta ? cuentaId : '',
        importe: String(ventaVigente.total_con_iva),
      })
      setCobrada({ numero: ventaVigente.numero, total: ventaVigente.total_con_iva })
      setVenta(null)
      setConfirmadaId(null)
    } catch (error) {
      setErrorVenta(fase === 'confirmar' ? mensajeDeConfirmarVenta(error) : mensajeDeCobroVenta(error))
    } finally {
      setCobrando(false)
    }
  }

  if (cargandoEmpresas) return <EstadoCargaPagina />
  if (errorEmpresas) return <EstadoError descripcion="No pudimos cargar tus tiendas." reintentar={() => void refetch()} />

  const encabezado = (
    <EncabezadoPagina
      titulo={TITULO_MOSTRADOR}
      descripcion="Escaneá los productos y cobrá en el momento. Por defecto la venta es a Consumidor final."
      contexto={<ContextoOrganizacionActiva />}
    />
  )

  if (!empresaActivaId) {
    return (
      <ContenedorSeccion>
        {encabezado}
        <EstadoVacio
          titulo="Elegí una tienda"
          descripcion={
            empresas.length === 0
              ? 'No tenés tiendas asignadas para vender en el mostrador.'
              : 'La venta de mostrador es de una sola tienda: elegila en la barra superior.'
          }
        />
      </ContenedorSeccion>
    )
  }

  const total = ventaVigente?.total_con_iva ?? 0
  const subtotal = ventaVigente?.total_sin_iva ?? 0
  const iva = ventaVigente?.iva ?? 0
  const sinFormas = formas.length === 0
  const falta = !formaId || (exigeCuenta && !cuentaId)

  return (
    <ContenedorSeccion>
      {encabezado}
      <Stack spacing={2}>
        {descarte && (
          <Alert severity="info" role="status">
            {descarte}
          </Alert>
        )}
        {cobrada && (
          <Alert severity="success" role="status" onClose={() => setCobrada(null)}>
            Venta cobrada · {cobrada.numero} · {formatearImporteHistorial(cobrada.total)}
          </Alert>
        )}
        <LectorCodigoBarras onEscanear={escanear} deshabilitado={cobrando || (ventaVigente !== null && confirmadaId === ventaVigente.id)} error={errorEscaneo} />

        {!ventaVigente ? (
          <EstadoVacio titulo="Todavía no hay productos" descripcion="Escaneá un código de barras para empezar la venta." />
        ) : (
          <>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Productos de la venta">
                <TableHead>
                  <TableRow>
                    <TableCell>Producto</TableCell>
                    <TableCell align="right">Cantidad</TableCell>
                    <TableCell align="right">Precio s/IVA</TableCell>
                    <TableCell align="right">Subtotal</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ventaVigente.lineas.map((linea) => (
                    <TableRow key={linea.id}>
                      <TableCell>
                        <Typography component="span" sx={{ fontWeight: 600 }}>{linea.descripcion}</Typography>
                        <Typography component="span" variant="caption" color="text.secondary" display="block">
                          {linea.codigo ?? '—'} · {rotuloEscalaLinea(linea)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{linea.cantidad}</TableCell>
                      <TableCell align="right">{formatearImporteHistorial(linea.precio_unitario)}</TableCell>
                      <TableCell align="right">{formatearImporteHistorial(linea.subtotal_sin_iva)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
              {/* Totales como en la pantalla de comprobante: el subtotal sin IVA y el IVA aparte (el precio de la
                  línea es sin IVA, así que el total con IVA se explica). */}
              <Stack spacing={0.5} role="group" aria-label="Totales de la venta" sx={{ ml: { md: 'auto' }, width: { xs: '100%', sm: 320 } }}>
                <Typography variant="body2" color="text.secondary">Subtotal sin IVA: {formatearImporteHistorial(subtotal)}</Typography>
                <Typography variant="body2" color="text.secondary">IVA: {formatearImporteHistorial(iva)}</Typography>
                <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  Total: {formatearImporteHistorial(total)}
                </Typography>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  select size="small" label="Forma de pago" value={formaId} sx={{ minWidth: 200 }}
                  onChange={(evento) => { setFormaId(evento.target.value); setCuentaId('') }}
                  disabled={cobrando || sinFormas}
                  helperText={sinFormas && !errorFormas ? 'Esta tienda no tiene formas de pago activas.' : undefined}
                >
                  {formas.map((forma) => <MenuItem key={forma.id} value={forma.id}>{forma.nombre}</MenuItem>)}
                </TextField>
                {exigeCuenta && (
                  <TextField
                    select size="small" label="Cuenta de cobro" value={cuentaId} sx={{ minWidth: 200 }}
                    onChange={(evento) => setCuentaId(evento.target.value)} disabled={cobrando}
                  >
                    {cuentas.cuentas.map((cuenta) => <MenuItem key={cuenta.id} value={cuenta.id}>{etiquetaCuentaCobro(cuenta)}</MenuItem>)}
                  </TextField>
                )}
                <Button variant="contained" onClick={() => void cobrar()} disabled={cobrando || falta || !puedeCobrar}>
                  {cobrando ? 'Cobrando…' : 'Cobrar'}
                </Button>
              </Stack>
            </Stack>
            {errorFormas && <Alert severity="error" role="alert">{errorFormas}</Alert>}
            {!puedeCobrar && (
              <Typography variant="caption" color="text.secondary">Tu rol no puede registrar cobros en esta tienda.</Typography>
            )}
            {errorVenta && <Alert severity="error" role="alert">{errorVenta}</Alert>}
          </>
        )}
      </Stack>
    </ContenedorSeccion>
  )
}
