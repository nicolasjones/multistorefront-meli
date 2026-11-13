import { lazy, Suspense, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router'
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { TarjetaBase } from '../../../components/base/TarjetaBase'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'
import { EstadoVacio } from '../../../components/estados/EstadosPagina'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { revisionEmpresaActiva, suscribirEmpresaActiva } from '../../../lib/empresaActivaRevision'
import { listarDepositosActivos } from '../../../lib/depositos'
import {
  formatoEntero, formatoPesos, formatoVariacion, leerResumenInicio, variacionPorcentual, type ResumenInicio,
} from '../../../lib/inicioTablero'
import { BloquesGestion } from './BloquesGestion'
import { MovimientosPorProducto } from './MovimientosPorProducto'
import { Indicador } from './Indicador'
import { FiltrosTablero } from './FiltrosTablero'
import { enlaceVentas, leerFiltros, parametrosConDeposito, parametrosConPeriodo, parametrosConTienda, TIENDA_TODAS } from './filtros'
import { useLecturaInicio } from '../useLecturaInicio'

// El gráfico (x-charts) no entra en el chunk inicial de Inicio: se baja al mostrarlo.
const GraficoVentasStock = lazy(() => import('./GraficoVentasStock').then((modulo) => ({ default: modulo.GraficoVentasStock })))

// Última revisión de la empresa activa que vio el tablero: si cambió mientras no estaba montado (la barra superior
// remonta Inicio), la tienda de la URL se descarta y vuelve a seguir a la empresa activa (el cambio de arriba gana).
let revisionVista: number | null = null

const GRILLA = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }

const tendenciaDe = (variacion: number | null) => (variacion === null ? null : variacion > 0 ? 'sube' : variacion < 0 ? 'baja' : 'igual')
const detalleVariacion = (variacion: number | null) =>
  variacion === null ? 'Sin período anterior para comparar' : `${formatoVariacion(variacion)} vs período anterior`

type Props = { verVentas: boolean; verStock: boolean; verActividad?: boolean; verReportes?: boolean }

// Tablero de Inicio (F-INI-04, MSF-820): filtros Período / Tienda / Depósito, «Ventas del período», «Stock hoy» y
// el gráfico «Ventas y stock en el tiempo». Una sola lectura (`resumen_inicio_periodo`); la base devuelve null en
// el bloque que el rol no puede ver, y ese bloque ni se muestra. El padre lo monta solo con ventas o stock ≥ lectura.
export function TableroInicio({ verVentas, verStock, verActividad = false, verReportes = false }: Props) {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])
  const { empresas, valor: empresaActiva, cargando: cargandoEmpresas, hayError: errorEmpresas } = useFiltroPorEmpresaActiva()
  const revision = useSyncExternalStore(suscribirEmpresaActiva, revisionEmpresaActiva, revisionEmpresaActiva)
  useEffect(() => {
    if (revisionVista !== null && revisionVista !== revision) setParams((actual) => parametrosConTienda(actual, null), { replace: true })
    revisionVista = revision
  }, [revision, setParams])

  // Tienda: la de la URL (si es una empresa accesible), «todas», o la empresa activa de la barra superior.
  const tiendaEnUrl = filtros.tienda
  const empresaId = tiendaEnUrl === TIENDA_TODAS
    ? null
    : tiendaEnUrl !== null && empresas.some((empresa) => empresa.id === tiendaEnUrl) ? tiendaEnUrl : empresaActiva

  const depositos = useLecturaInicio(listarDepositosActivos, { habilitado: verVentas || verStock })
  // Un depósito de la URL que no existe en la organización (o dado de baja) cae a «Todos los depósitos».
  const depositoId = filtros.depositoId !== null && depositos.datos?.some((deposito) => deposito.id === filtros.depositoId) ? filtros.depositoId : null
  const filtrosVigentes = useMemo(() => ({ ...filtros, depositoId }), [filtros, depositoId])

  const { desde, hasta } = filtros.rango
  const clave = `${desde}|${hasta}|${empresaId ?? ''}|${depositoId ?? ''}`
  const leer = useCallback(
    async () => ({ clave, resumen: await leerResumenInicio({ desde, hasta, empresaId, depositoId }) }),
    [clave, desde, hasta, empresaId, depositoId],
  )
  // Con un depósito en la URL se espera a validarlo contra la lista antes de consultar (una sola lectura).
  const lectura = useLecturaInicio(leer, { habilitado: !cargandoEmpresas && (filtros.depositoId === null || !depositos.cargando) })
  // Mientras llegan los datos de unos filtros nuevos no se muestran los de los filtros anteriores.
  const resumen: ResumenInicio | null = lectura.datos !== null && lectura.datos.clave === clave ? lectura.datos.resumen : null
  const cargando = lectura.cargando || (!lectura.hayError && resumen === null)
  const contexto = useMemo(() => ({ desde, hasta, empresaId, depositoId }), [desde, hasta, empresaId, depositoId])

  return (
    <Stack spacing={2} component="section" aria-label="Tablero de ventas y stock">
      <FiltrosTablero
        filtros={filtrosVigentes}
        onPeriodo={(periodo, rango) => setParams(parametrosConPeriodo(params, periodo, rango), { replace: true })}
        tienda={(
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(tienda) => setParams(parametrosConTienda(params, tienda ?? TIENDA_TODAS), { replace: true })}
            cargando={cargandoEmpresas}
            hayError={errorEmpresas}
            textoAyuda="Las ventas y las devoluciones se acotan a la tienda; el stock es compartido entre tiendas."
          />
        )}
        depositos={depositos.datos}
        onDeposito={(depositoId) => setParams(parametrosConDeposito(params, depositoId), { replace: true })}
      />

      {lectura.hayError ? (
        <Stack spacing={1} alignItems="flex-start" role="alert">
          <Typography>No pudimos cargar este dato</Typography>
          <Button size="small" variant="outlined" onClick={() => void lectura.recargar()}>Reintentar</Button>
        </Stack>
      ) : cargando ? (
        <Box role="status" aria-label="Cargando el tablero" aria-busy="true"><Skeleton variant="rounded" height={120} /></Box>
      ) : resumen !== null && resumen.ventas === null && resumen.stock === null ? (
        <EstadoVacio titulo="No hay datos para mostrar" descripcion="No tenés ventas ni stock habilitados para esta tienda o este depósito. Probá con otra tienda." />
      ) : resumen !== null ? (
        <>
          {resumen.ventas ? <BloqueVentas resumen={resumen} verReportes={verReportes} /> : null}
          {resumen.stock ? <BloqueStock resumen={resumen} depositoId={depositoId} /> : null}
          <TarjetaBase titulo="Ventas y stock en el tiempo">
            <Suspense fallback={<Box role="status" aria-label="Cargando el gráfico" aria-busy="true"><Skeleton variant="rounded" height={300} /></Box>}>
              <GraficoVentasStock serie={resumen.serie} hayVentas={resumen.ventas !== null} hayStock={resumen.stock !== null} />
            </Suspense>
          </TarjetaBase>
        </>
      ) : null}

      {!cargandoEmpresas && (verVentas || verStock || verActividad) ? (
        <BloquesGestion contexto={contexto} verVentas={verVentas} verStock={verStock} verActividad={verActividad} />
      ) : null}
      {!cargandoEmpresas && verStock ? <MovimientosPorProducto contexto={contexto} /> : null}
    </Stack>
  )
}

function BloqueVentas({ resumen, verReportes }: { resumen: ResumenInicio; verReportes: boolean }) {
  const ventas = resumen.ventas!
  // Reportes de ventas exige la sección `reportes` (que muchos roles con `ventas` no tienen): sin ella el indicador
  // no enlaza. Reportes sigue a la empresa activa y no admite una tienda por URL: el enlace lleva solo el período.
  const enlace = verReportes ? enlaceVentas({ desde: resumen.desde, hasta: resumen.hasta }) : undefined
  const variacionMonto = variacionPorcentual(ventas.monto, ventas.anterior_monto)
  const variacionComprobantes = variacionPorcentual(ventas.comprobantes, ventas.anterior_comprobantes)
  const ticketAnterior = ventas.anterior_comprobantes > 0 ? ventas.anterior_monto / ventas.anterior_comprobantes : null
  const variacionTicket = ventas.ticket_promedio === null || ticketAnterior === null ? null : variacionPorcentual(ventas.ticket_promedio, ticketAnterior)
  const sinVentas = ventas.comprobantes === 0 && ventas.monto === 0 && ventas.unidades === 0
  return (
    <TarjetaBase titulo="Ventas del período">
      <Stack spacing={1.5}>
        {sinVentas ? <Typography color="text.secondary">No hay ventas en este período.</Typography> : null}
        <Box sx={GRILLA}>
          <Indicador rotulo="Ventas (con IVA)" valor={formatoPesos(ventas.monto)} detalle={detalleVariacion(variacionMonto)} tendencia={tendenciaDe(variacionMonto)} to={enlace} />
          <Indicador rotulo="Comprobantes" valor={formatoEntero(ventas.comprobantes)} detalle={detalleVariacion(variacionComprobantes)} tendencia={tendenciaDe(variacionComprobantes)} to={enlace} />
          <Indicador rotulo="Ticket promedio (con IVA)" valor={ventas.ticket_promedio === null ? '—' : formatoPesos(ventas.ticket_promedio)} detalle={detalleVariacion(variacionTicket)} tendencia={tendenciaDe(variacionTicket)} to={enlace} />
          <Indicador rotulo="Unidades vendidas" valor={formatoEntero(ventas.unidades)} detalle="Netas de devoluciones" to={enlace} />
          <Indicador rotulo="Devoluciones (con IVA)" valor={formatoPesos(ventas.devoluciones_monto)} detalle={`${formatoEntero(ventas.devoluciones_unidades)} unidades devueltas`} to={enlace} />
        </Box>
      </Stack>
    </TarjetaBase>
  )
}

function BloqueStock({ resumen, depositoId }: { resumen: ResumenInicio; depositoId: string | null }) {
  const stock = resumen.stock!
  const aStock = (filtro?: 'sin_stock' | 'stock_bajo') => {
    const parametros = new URLSearchParams()
    if (filtro) parametros.set('filtro', filtro)
    if (depositoId) parametros.set('deposito', depositoId)
    const texto = parametros.toString()
    return `/stock${texto ? `?${texto}` : ''}`
  }
  return (
    <TarjetaBase titulo="Stock hoy">
      <Box sx={GRILLA}>
        <Indicador rotulo="Stock actual" valor={`${formatoEntero(stock.unidades)} u.`} detalle="Unidades en stock" to={aStock()} />
        <Indicador rotulo="Reservado" valor={`${formatoEntero(stock.reservado)} u.`} detalle="Para pedidos en curso" to={aStock()} />
        <Indicador rotulo="Disponible para vender" valor={`${formatoEntero(stock.disponible)} u.`} detalle="Stock menos reservado" to={aStock()} />
        <Indicador rotulo="Sin stock" valor={formatoEntero(stock.sin_stock)} detalle={stock.sin_stock === 1 ? 'producto' : 'productos'} to={aStock('sin_stock')} />
        <Indicador rotulo="Stock bajo" valor={formatoEntero(stock.stock_bajo)} detalle={stock.stock_bajo === 1 ? 'producto' : 'productos'} to={aStock('stock_bajo')} />
        <Indicador
          rotulo="Ajustes de stock"
          valor={formatoEntero(stock.ajustes)}
          detalle={`Entradas en el período: +${formatoEntero(stock.entradas_unidades)} u.`}
          to="/stock/movimientos"
        />
      </Box>
    </TarjetaBase>
  )
}
