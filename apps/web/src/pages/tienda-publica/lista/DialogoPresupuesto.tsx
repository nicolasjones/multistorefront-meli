import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import type { LineaPedido } from '../../../lib/listaPedido'
import { minutosDeEspera } from '../../../lib/tiendaContacto'
import { formatearCantidad, formatearImporteArs } from '../../../lib/tiendaCuentaDatos'
import {
  cotizarPresupuesto,
  crearPresupuesto,
  MENSAJES_PEDIDO,
  type Cotizacion,
  type ResultadoPresupuesto,
} from '../../../lib/tiendaPedido'
import { ErrorConReintento } from '../ErrorConReintento'
import { LINEA_SUAVE } from '../layout/medidas'
import { useCelular } from '../useAnchoCelular'

export const TITULO_PRESUPUESTO = 'Tu presupuesto'
export const LEYENDA_PRESUPUESTO =
  'Es un presupuesto, no una compra: no reserva stock ni se cobra nada. El precio puede ser menor que el de referencia de la lista porque incluye tu descuento y las promociones vigentes.'
export const TEXTO_ERROR_PRESUPUESTO = 'No pudimos pedir tu presupuesto. Tu lista sigue acá: probá de nuevo.'
export const TEXTO_LIMITE_CUENTA = 'Ya tenés presupuestos abiertos. Esperá nuestra respuesta para pedir otro.'
export const TEXTO_NOTA_PRESUPUESTO = `${MENSAJES_PEDIDO.nota} Y no puede llevar caracteres que no podemos aceptar.`
export const TEXTO_REVISAR_PRESUPUESTO = 'Revisá tu lista: hay productos que no se pueden pedir en un presupuesto.'
const ID_TITULO = 'dialogo-presupuesto-titulo'

export type PresupuestoConfirmado = { numero: string; totalConIva: number; cambioElPrecio: boolean }

type Cotizando =
  | { fase: 'cotizando' }
  | { fase: 'cotizado'; cotizacion: Cotizacion }
  | { fase: 'espera'; segundos: number }
  | { fase: 'invalido' }
  | { fase: 'falla' }

const sinNombre = 'un producto de tu lista'

// «Tu presupuesto» (MSF-176, B2, FR-050, P-4). Al abrirlo pide la cotización del SERVIDOR (`cotizar_presupuesto_tienda`): líneas con el precio que le corresponde a la cuenta (su escala, su descuento y las
// promociones vigentes), subtotal, IVA y total con IVA; «lo que ves es lo que se crea» porque la creación usa el mismo motor. «Confirmar presupuesto» queda deshabilitado mientras haya productos no
// disponibles o sin precio, que se listan. Una sola petición de creación en vuelo; la `clave_envio` viene de la pantalla (la misma en «Reintentar»: repetirla devuelve el MISMO presupuesto). Ante cualquier
// error la lista se conserva. `fullScreen` en celular y tableta; desde `md`, `maxWidth="md"`.
export function DialogoPresupuesto({ host, lineas, nota, claveEnvio, nombres, alCerrar, alConfirmado, alSinAcceso }: {
  host: string
  lineas: readonly LineaPedido[]
  nota: string
  claveEnvio: string
  // Nombres conocidos de los productos de la lista (para nombrar los que no se pueden cotizar o pedir).
  nombres: ReadonlyMap<string, string>
  alCerrar: () => void
  alConfirmado: (presupuesto: PresupuestoConfirmado) => void
  alSinAcceso: () => void
}) {
  const celular = useCelular()
  const [estado, setEstado] = useState<Cotizando>({ fase: 'cotizando' })
  const [intento, setIntento] = useState(0)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<Exclude<ResultadoPresupuesto, { estado: 'exito' }> | null>(null)
  // `limite` al confirmar: el botón queda deshabilitado hasta cumplirse la espera (con el tiempo que falta a la vista) y recién ahí se puede reintentar.
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const enVuelo = useRef(false)
  const titulo = useRef<HTMLHeadingElement | null>(null)
  const firmaLineas = JSON.stringify(lineas)

  useEffect(() => {
    let cancelada = false
    setEstado({ fase: 'cotizando' })
    void cotizarPresupuesto(host, JSON.parse(firmaLineas) as LineaPedido[]).then((r) => {
      if (cancelada) return
      switch (r.estado) {
        case 'ok': setEstado({ fase: 'cotizado', cotizacion: r.cotizacion }); return
        case 'sin_acceso': alSinAcceso(); return
        case 'espera': setEstado({ fase: 'espera', segundos: r.esperaSegundos }); return
        case 'invalido': setEstado({ fase: 'invalido' }); return
        default: setEstado({ fase: 'falla' })
      }
    })
    return () => { cancelada = true }
    // `firmaLineas` resume la lista; `intento` fuerza otra cotización; `alSinAcceso` es estable en la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, firmaLineas, intento])

  useEffect(() => {
    if (bloqueadoHasta === null) return
    const temporizador = setInterval(() => {
      const hoy = Date.now()
      setAhora(hoy)
      if (hoy >= bloqueadoHasta) { setBloqueadoHasta(null); setResultado(null) }
    }, 1000)
    return () => clearInterval(temporizador)
  }, [bloqueadoHasta])
  const segundosRestantes = bloqueadoHasta === null ? 0 : Math.max(1, Math.ceil((bloqueadoHasta - ahora) / 1000))

  const nombreDe = useCallback((id: string | null) => (id ? nombres.get(id) ?? sinNombre : sinNombre), [nombres])
  const cotizacion = estado.fase === 'cotizado' ? estado.cotizacion : null
  const bloqueada = (cotizacion ? cotizacion.noDisponibles.length > 0 || cotizacion.sinPrecio.length > 0 || cotizacion.lineas.length === 0 : true) || bloqueadoHasta !== null

  const confirmar = async () => {
    if (enVuelo.current || !cotizacion || bloqueada) return
    enVuelo.current = true
    setConfirmando(true)
    setResultado(null)
    try {
      const r = await crearPresupuesto(host, lineas, nota, claveEnvio)
      if (r.estado === 'exito') {
        alConfirmado({ numero: r.numero, totalConIva: r.totalConIva, cambioElPrecio: Math.abs(r.totalConIva - cotizacion.totalConIva) >= 0.005 })
        return
      }
      if (r.estado === 'sin_acceso') {
        alSinAcceso()
        return
      }
      if (r.estado === 'espera') {
        const hasta = Date.now() + r.esperaSegundos * 1000
        setAhora(Date.now())
        setBloqueadoHasta(hasta)
      }
      setResultado(r)
    } finally {
      enVuelo.current = false
      setConfirmando(false)
    }
  }

  const mensajeResultado = (r: Exclude<ResultadoPresupuesto, { estado: 'exito' }>) => {
    switch (r.estado) {
      case 'sin_precio': return `No pudimos calcular el precio de «${nombreDe(r.productoId)}». Quitalo de la lista o enviá el pedido sin presupuesto.`
      case 'no_disponible': return `«${nombreDe(r.productoId)}» ya no está disponible. Quitalo para continuar.`
      case 'espera': { const m = minutosDeEspera(bloqueadoHasta === null ? r.esperaSegundos : segundosRestantes); return `Hiciste varios envíos seguidos. Probá de nuevo en ${m} ${m === 1 ? 'minuto' : 'minutos'}.` }
      case 'limite_cuenta': return TEXTO_LIMITE_CUENTA
      // Cada campo con su mensaje: la nota no es «Revisá tu lista».
      case 'invalido': return r.campos.includes('items') ? TEXTO_REVISAR_PRESUPUESTO : r.campos.includes('nota') ? TEXTO_NOTA_PRESUPUESTO : TEXTO_ERROR_PRESUPUESTO
      default: return TEXTO_ERROR_PRESUPUESTO
    }
  }

  return (
    <Dialog open onClose={confirmando ? undefined : alCerrar} fullScreen={celular} fullWidth maxWidth="md" aria-labelledby={ID_TITULO} slotProps={{ transition: { onEntered: () => titulo.current?.focus() } }}>
      <DialogTitle id={ID_TITULO} component="h2" ref={titulo} tabIndex={-1} sx={{ outline: 'none', overflowWrap: 'anywhere' }}>{TITULO_PRESUPUESTO}</DialogTitle>
      <DialogContent dividers>
        {estado.fase === 'cotizando' ? <EstadoCargaPagina etiqueta="Calculando tu presupuesto" /> : null}
        {estado.fase === 'falla' ? <ErrorConReintento titulo="No pudimos calcular tu presupuesto." descripcion="Revisá tu conexión y probá de nuevo." alReintentar={() => setIntento((n) => n + 1)} /> : null}
        {estado.fase === 'invalido' ? <Alert severity="warning">{TEXTO_REVISAR_PRESUPUESTO}</Alert> : null}
        {estado.fase === 'espera' ? (
          <Alert severity="warning" sx={{ alignItems: 'center' }} action={<Button color="inherit" onClick={() => setIntento((n) => n + 1)} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Reintentar</Button>}>
            {(() => { const m = minutosDeEspera(estado.segundos); return `Hiciste varios envíos seguidos. Probá de nuevo en ${m} ${m === 1 ? 'minuto' : 'minutos'}.` })()}
          </Alert>
        ) : null}
        {cotizacion ? (
          <Box>
            {cotizacion.noDisponibles.map((id) => (
              <Alert key={`nd-${id}`} severity="warning" sx={{ mb: 1 }}>{`«${nombreDe(id)}» ya no está disponible. Quitalo para continuar.`}</Alert>
            ))}
            {cotizacion.sinPrecio.map((id) => (
              <Alert key={`sp-${id}`} severity="warning" sx={{ mb: 1 }}>{`No pudimos calcular el precio de «${nombreDe(id)}». Quitalo de la lista o enviá el pedido sin presupuesto.`}</Alert>
            ))}
            {cotizacion.lineas.length > 0 ? <Lineas cotizacion={cotizacion} celular={celular} /> : null}
            <Box component="dl" sx={{ m: 0, mt: 2, ml: 'auto', maxWidth: (tema) => tema.spacing(40), display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 2, rowGap: 0.5 }}>
              <Typography component="dt" color="text.secondary">Subtotal sin IVA</Typography>
              <Typography component="dd" align="right" sx={{ m: 0 }} data-testid="presupuesto-subtotal">{formatearImporteArs(cotizacion.totalSinIva)}</Typography>
              <Typography component="dt" color="text.secondary">IVA</Typography>
              <Typography component="dd" align="right" sx={{ m: 0 }} data-testid="presupuesto-iva">{formatearImporteArs(cotizacion.iva)}</Typography>
              <Typography component="dt" sx={{ fontWeight: 700 }}>Total con IVA</Typography>
              <Typography component="dd" align="right" sx={{ m: 0, fontWeight: 700 }} data-testid="presupuesto-total">{formatearImporteArs(cotizacion.totalConIva)}</Typography>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>{LEYENDA_PRESUPUESTO}</Alert>
          </Box>
        ) : null}
        {resultado ? (
          <Alert
            severity={resultado.estado === 'falla' || (resultado.estado === 'invalido' && !resultado.campos.includes('items') && !resultado.campos.includes('nota')) ? 'error' : 'warning'}
            role="alert"
            sx={{ mt: 2, alignItems: 'center' }}
            action={resultado.estado === 'falla' || (resultado.estado === 'invalido' && !resultado.campos.includes('items') && !resultado.campos.includes('nota')) ? <Button color="inherit" onClick={() => { void confirmar() }} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Reintentar</Button> : undefined}
            data-testid="resultado-presupuesto"
          >
            {mensajeResultado(resultado)}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'center' }, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        <Button onClick={alCerrar} disabled={confirmando} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Volver a la lista</Button>
        <Button variant="contained" onClick={() => { void confirmar() }} disabled={bloqueada || confirmando || estado.fase !== 'cotizado'} aria-busy={confirmando || undefined} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>
          {confirmando ? 'Confirmando…' : 'Confirmar presupuesto'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function Lineas({ cotizacion, celular }: { cotizacion: Cotizacion; celular: boolean }) {
  if (celular) {
    return (
      <Box component="ul" aria-label="Productos del presupuesto" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
        {cotizacion.lineas.map((linea) => (
          <Box component="li" key={linea.productoId} sx={{ border: LINEA_SUAVE, borderRadius: '8px', p: 1.5, display: 'flex', justifyContent: 'space-between', gap: 2 /* estilos-sueltos: ok */ }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{linea.descripcion}</Typography>
              {linea.codigo ? <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */, overflowWrap: 'anywhere' }}>Cód. {linea.codigo}</Typography> : null}
              <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{formatearCantidad(linea.cantidad)} × {formatearImporteArs(linea.precioUnitario)}</Typography>
            </Box>
            <Typography sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatearImporteArs(linea.subtotalSinIva)}</Typography>
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <TableContainer>
      <Table size="small" aria-label="Productos del presupuesto">
        <TableHead>
          <TableRow>
            <TableCell>Producto</TableCell>
            <TableCell align="right">Cantidad</TableCell>
            <TableCell align="right">Precio unitario</TableCell>
            <TableCell align="right">Subtotal</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {cotizacion.lineas.map((linea) => (
            <TableRow key={linea.productoId}>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>
                {linea.descripcion}
                {linea.codigo ? <Typography component="span" color="text.secondary" sx={{ display: 'block', fontSize: 13 /* estilos-sueltos: ok */ }}>Cód. {linea.codigo}</Typography> : null}
              </TableCell>
              <TableCell align="right">{formatearCantidad(linea.cantidad)}</TableCell>
              <TableCell align="right">{formatearImporteArs(linea.precioUnitario)}</TableCell>
              <TableCell align="right">{formatearImporteArs(linea.subtotalSinIva)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
