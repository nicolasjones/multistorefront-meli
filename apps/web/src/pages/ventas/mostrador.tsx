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
  esEan13, mensajeDeCobroVenta, mensajeDeConfirmarVenta, mensajeDeEscaneo, obtenerConsumidorFinal,
  MENSAJE_CODIGO_INVALIDO,
} from '../../lib/ventasMostrador'
import { LectorCodigoBarras } from '../../components/ventas/LectorCodigoBarras'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

export const TITULO_MOSTRADOR = 'Venta de mostrador'

// Venta de mostrador con lector de código de barras (F-VTA-31, MSF-329; FR-002…FR-005). La venta en curso es una
// factura `borrador` (canal Mostrador, Consumidor final, empresa activa) que se crea al primer escaneo. La base
// calcula precios y totales. Al cambiar la empresa activa la venta en curso se descarta con aviso (Principio VIII).
export function VentaMostrador() {
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas, refetch } = useEmpresasAccesibles()
  const [venta, setVenta] = useState<Comprobante | null>(null)
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [errorEscaneo, setErrorEscaneo] = useState<string | null>(null)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)
  const [cobrada, setCobrada] = useState<{ numero: string; total: number } | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [confirmadaId, setConfirmadaId] = useState<string | null>(null)
  const [formas, setFormas] = useState<FormaPago[]>([])
  const [formaId, setFormaId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [puedeCobrar, setPuedeCobrar] = useState(true)
  const enVuelo = useRef(false)
  // Empresa vigente para descartar respuestas que llegan después de cambiar de tienda.
  const empresaVigente = useRef<string | null>(null)
  useEffect(() => {
    empresaVigente.current = empresaActivaId
  }, [empresaActivaId])

  // La venta de otra tienda no se muestra ni se cobra bajo la nueva (derivado, sin efecto).
  const ventaVigente = venta && venta.empresa_id === empresaActivaId ? venta : null
  const ventaDescartada = venta && venta.empresa_id !== empresaActivaId ? venta : null
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
      })
      .catch((error) => {
        if (!vigente) return
        console.error('No se pudieron cargar las formas de pago del mostrador', error instanceof Error ? error.message : error)
        setFormas([])
      })
    return () => {
      vigente = false
    }
  }, [empresaActivaId])

  const escanear = useCallback(
    async (codigo: string) => {
      if (!empresaActivaId || enVuelo.current) return
      setErrorEscaneo(null)
      setErrorVenta(null)
      if (!esEan13(codigo)) {
        setErrorEscaneo(MENSAJE_CODIGO_INVALIDO)
        return
      }
      enVuelo.current = true
      const empresaDelEscaneo = empresaActivaId
      try {
        const producto = await buscarProductoPorCodigoBarras(codigo)
        if (!producto) {
          setErrorEscaneo(MENSAJE_PRODUCTO_NO_ENCONTRADO)
          return
        }
        let cliente = clienteId
        if (!cliente) {
          cliente = await obtenerConsumidorFinal()
          if (!cliente) {
            setErrorEscaneo(MENSAJE_SIN_CONSUMIDOR_FINAL)
            return
          }
          setClienteId(cliente)
        }
        const base = venta && venta.empresa_id === empresaDelEscaneo ? venta : null
        const actualizada = await agregarProductoAVenta(base, empresaDelEscaneo, cliente, producto.producto_id)
        // Cambió la tienda mientras se resolvía: esa venta no se muestra bajo la nueva.
        if (empresaVigente.current === empresaDelEscaneo) setVenta(actualizada)
      } catch (error) {
        setErrorEscaneo(mensajeDeEscaneo(error))
      } finally {
        enVuelo.current = false
      }
    },
    [empresaActivaId, clienteId, venta],
  )

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
  const sinFormas = formas.length === 0
  const falta = !formaId || (exigeCuenta && !cuentaId)

  return (
    <ContenedorSeccion>
      {encabezado}
      <Stack spacing={2}>
        {ventaDescartada && (
          <Alert severity="info" role="status">
            Cambiaste de tienda: se descartó la venta en curso ({ventaDescartada.empresa}). Empezá una nueva escaneando un producto.
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
                    <TableCell align="right">Precio</TableCell>
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
                      <TableCell align="right">{formatearImporteHistorial(linea.subtotal_sin_iva + linea.iva)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
              <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                Total: {formatearImporteHistorial(total)}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  select size="small" label="Forma de pago" value={formaId} sx={{ minWidth: 200 }}
                  onChange={(evento) => { setFormaId(evento.target.value); setCuentaId('') }}
                  disabled={cobrando || sinFormas}
                  helperText={sinFormas ? 'Esta tienda no tiene formas de pago activas.' : undefined}
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
