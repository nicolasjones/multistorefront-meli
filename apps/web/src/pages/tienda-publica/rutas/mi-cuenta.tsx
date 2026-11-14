import { Alert, Box, Button, Tab, Tabs, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as EnlaceRuta, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useSesionClienteDetallada } from '../../../hooks/useSesionCliente'
import { salirCliente } from '../../../lib/tiendaCuenta'
import { enlaceIngresarConVolver } from '../../../lib/tiendaVolver'
import { DetalleCompra } from '../cuenta/DetalleCompra'
import { FavoritosMiCuenta } from '../cuenta/FavoritosMiCuenta'
import { HistorialMiCuenta } from '../cuenta/HistorialMiCuenta'
import { ErrorConReintento } from '../ErrorConReintento'
import { useContextoTienda } from '../layout/LayoutTienda'
import { MigasTienda } from '../layout/MigasTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { CabeceraSeo } from '../seo/CabeceraSeo'

type Seccion = 'compras' | 'favoritos'
const SECCIONES: readonly Seccion[] = ['compras', 'favoritos']
const seccionDe = (valor: string | null): Seccion => (valor === 'favoritos' ? 'favoritos' : 'compras')

// `/mi-cuenta` (F-CLI-20, FR-001/FR-002/FR-011/FR-014, P-3): las compras y presupuestos del cliente y sus favoritos, en pestañas
// (`?seccion=compras|favoritos`; el detalle de un comprobante viaja en `?compra=<id>`). Sin sesión, o con una cuenta que no está
// activa y habilitada en esta tienda, lleva a «Ingresar» con la ruta de vuelta SIN decir el motivo (el servidor tampoco lo
// distingue); con la función apagada es la 404 de la tienda; si la cuenta deja de estar activa con la pantalla abierta, el
// primer error de acceso reemplaza todo el contenido por el aviso, sin conservar ningún dato previo.
export default function RutaMiCuenta() {
  const { host, tienda } = useContextoTienda()
  const parametros = useParams()
  const capacidades = useCapacidadesTienda(host)
  const sesion = useSesionClienteDetallada(host)
  const ubicacion = useLocation()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [sinAcceso, setSinAcceso] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const [visitadas, setVisitadas] = useState<ReadonlySet<Seccion>>(() => new Set([seccionDe(params.get('seccion'))]))
  const titulo = useRef<HTMLHeadingElement | null>(null)
  const seccion = seccionDe(params.get('seccion'))
  const compra = params.get('compra')
  const alSinAcceso = useCallback(() => setSinAcceso(true), [])

  const listaParaMostrar = capacidades.fase === 'lista' && capacidades.pedidos && sesion.estado === 'activa'
  // Al entrar (y al pasar de «cargando» a la pantalla, o al aviso de cuenta inactiva) el foco va al título de la página.
  useEffect(() => {
    if (listaParaMostrar) titulo.current?.focus()
  }, [listaParaMostrar, sinAcceso])
  // Una sección ya visitada sigue cargada (con su lista y su scroll) al cambiar de pestaña, hasta salir de la página.
  if (!visitadas.has(seccion)) setVisitadas(new Set([...visitadas, seccion]))

  // `/mi-cuenta/<algo>` no existe.
  if (Object.values(parametros).some((valor) => valor)) return <PaginaNoEncontrada />
  if (capacidades.fase === 'error') {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi cuenta" /><ErrorConReintento titulo="No pudimos cargar esta página." alReintentar={capacidades.reintentar} /></Box>
  }
  if (capacidades.fase === 'lista' && !capacidades.pedidos) return <PaginaNoEncontrada />
  // Sin la función encendida nadie va a «Ingresar» (un anónimo ve la 404, FR-014): mientras no se sabe, solo carga.
  if (capacidades.fase === 'cargando') {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi cuenta" /><EstadoCargaPagina etiqueta="Cargando tu cuenta" /></Box>
  }
  if (sesion.estado === 'sin_sesion') {
    return <Navigate to={enlaceIngresarConVolver(`${ubicacion.pathname}${ubicacion.search}`)} replace />
  }
  if (sesion.estado === 'desconocida' && sesion.falla) {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi cuenta" /><ErrorConReintento titulo="No pudimos verificar tu acceso." alReintentar={sesion.reintentar} /></Box>
  }
  if (!listaParaMostrar) {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi cuenta" /><EstadoCargaPagina etiqueta="Cargando tu cuenta" /></Box>
  }

  const irASeccion = (nueva: Seccion) => {
    setParams({ seccion: nueva })
  }
  // Abierto desde la lista (entrada nueva en el historial): cerrar vuelve a esa entrada y «atrás» no reabre el detalle.
  // Abierto por un enlace directo (sin esa marca): se reemplaza la entrada.
  const cerrarDetalle = () => {
    if ((ubicacion.state as { desdeLista?: boolean } | null)?.desdeLista) navigate(-1)
    else setParams({ seccion: 'compras' }, { replace: true })
  }
  const salir = () => {
    setSaliendo(true)
    void salirCliente().finally(() => navigate('/'))
  }

  return (
    <Box sx={{ pb: 4 }}>
      <CabeceraSeo noindex pagina="Mi cuenta" />
      <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: 'Mi cuenta' }]} />
      {sinAcceso ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Typography ref={titulo} tabIndex={-1} component="h1" sx={{ fontWeight: 600, outline: 'none' }}>Tu cuenta no está activa en esta tienda</Typography>
          <Typography>Si creés que es un error, escribinos desde Contacto.</Typography>
          <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button component={EnlaceRuta} to="/contacto" variant="contained" size="small" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Ir a Contacto</Button>
            <Button variant="outlined" size="small" disabled={saliendo} onClick={salir} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Salir</Button>
          </Box>
        </Alert>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
            <Typography ref={titulo} tabIndex={-1} component="h1" variant="h4" sx={{ outline: 'none', overflowWrap: 'anywhere' }}>Mi cuenta</Typography>
            {/* En celular y tableta «Salir» ya no está en el encabezado (pasa al menú y a esta página). */}
            <Button variant="outlined" size="small" disabled={saliendo} onClick={salir} sx={{ display: { xs: 'inline-flex', md: 'none' }, minHeight: (tema) => tema.spacing(5.5) }}>Salir</Button>
          </Box>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>Tus compras y presupuestos en {tienda.empresaNombre}</Typography>
          <Tabs
            value={seccion}
            onChange={(_evento, valor: Seccion) => irASeccion(valor)}
            aria-label="Secciones de Mi cuenta"
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="compras" label="Compras y presupuestos" id="mi-cuenta-tab-compras" aria-controls="mi-cuenta-panel-compras" />
            <Tab value="favoritos" label="Favoritos" id="mi-cuenta-tab-favoritos" aria-controls="mi-cuenta-panel-favoritos" />
          </Tabs>
          {SECCIONES.map((nombre) => (
            <Box key={nombre} role="tabpanel" id={`mi-cuenta-panel-${nombre}`} aria-labelledby={`mi-cuenta-tab-${nombre}`} hidden={seccion !== nombre} sx={{ pt: 2 }}>
              {visitadas.has(nombre) || seccion === nombre ? (
                nombre === 'compras'
                  ? <HistorialMiCuenta host={host} alSinAcceso={alSinAcceso} />
                  : <FavoritosMiCuenta host={host} alSinAcceso={alSinAcceso} />
              ) : null}
            </Box>
          ))}
          {compra && seccion === 'compras' ? <DetalleCompra host={host} comprobanteId={compra} alCerrar={cerrarDetalle} alSinAcceso={alSinAcceso} /> : null}
        </>
      )}
    </Box>
  )
}
