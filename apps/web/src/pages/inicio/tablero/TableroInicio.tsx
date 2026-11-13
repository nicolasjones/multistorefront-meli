import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { TarjetaBase } from '../../../components/base/TarjetaBase'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'
import { EstadoVacio } from '../../../components/estados/EstadosPagina'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { listarDepositosActivos } from '../../../lib/depositos'
import {
  formatoEntero, formatoPesos, formatoVariacion, leerResumenInicio, variacionPorcentual, type ResumenInicio,
} from '../../../lib/inicioTablero'
import { GraficoVentasStock } from './GraficoVentasStock'
import { Indicador } from './Indicador'
import { FiltrosTablero } from './FiltrosTablero'
import { enlaceVentas, leerFiltros, parametrosConDeposito, parametrosConPeriodo } from './filtros'
import { useLecturaInicio } from '../useLecturaInicio'

const GRILLA = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }

const tendenciaDe = (variacion: number | null) => (variacion === null ? null : variacion > 0 ? 'sube' : variacion < 0 ? 'baja' : 'igual')
const detalleVariacion = (variacion: number | null) =>
  variacion === null ? 'Sin período anterior para comparar' : `${formatoVariacion(variacion)} vs período anterior`

type Props = { verVentas: boolean; verStock: boolean }

// Tablero de Inicio (F-INI-04, MSF-820): filtros Período / Tienda / Depósito, «Ventas del período», «Stock hoy» y
// el gráfico «Ventas y stock en el tiempo». Una sola lectura (`resumen_inicio_periodo`); la base devuelve null en
// el bloque que el rol no puede ver, y ese bloque ni se muestra. El padre lo monta solo con ventas o stock ≥ lectura.
export function TableroInicio({ verVentas, verStock }: Props) {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoEmpresas, hayError: errorEmpresas } = useFiltroPorEmpresaActiva()

  const depositos = useLecturaInicio(listarDepositosActivos, { habilitado: verVentas || verStock })

  const { desde, hasta } = filtros.rango
  const clave = `${desde}|${hasta}|${empresaId ?? ''}|${filtros.depositoId ?? ''}`
  const leer = useCallback(
    async () => ({ clave, resumen: await leerResumenInicio({ desde, hasta, empresaId, depositoId: filtros.depositoId }) }),
    [clave, desde, hasta, empresaId, filtros.depositoId],
  )
  const lectura = useLecturaInicio(leer, { habilitado: !cargandoEmpresas })
  // Mientras llegan los datos de unos filtros nuevos no se muestran los de los filtros anteriores.
  const resumen: ResumenInicio | null = lectura.datos !== null && lectura.datos.clave === clave ? lectura.datos.resumen : null
  const cargando = lectura.cargando || (!lectura.hayError && resumen === null)

  return (
    <Stack spacing={2} component="section" aria-label="Tablero de ventas y stock">
      <FiltrosTablero
        filtros={filtros}
        onPeriodo={(periodo, rango) => setParams(parametrosConPeriodo(params, periodo, rango), { replace: true })}
        tienda={(
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={elegirEmpresa}
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
          <Typography>No pudimos cargar el tablero</Typography>
          <Button size="small" variant="outlined" onClick={() => void lectura.recargar()}>Reintentar</Button>
        </Stack>
      ) : cargando ? (
        <Box role="status" aria-label="Cargando el tablero" aria-busy="true"><Skeleton variant="rounded" height={120} /></Box>
      ) : resumen !== null && resumen.ventas === null && resumen.stock === null ? (
        <EstadoVacio titulo="No hay datos para mostrar" descripcion="Tu rol no tiene ventas ni stock habilitados en esta vista." />
      ) : resumen !== null ? (
        <>
          {resumen.ventas ? <BloqueVentas resumen={resumen} /> : null}
          {resumen.stock ? <BloqueStock resumen={resumen} depositoId={filtros.depositoId} /> : null}
          <TarjetaBase titulo="Ventas y stock en el tiempo">
            <GraficoVentasStock serie={resumen.serie} hayVentas={resumen.ventas !== null} hayStock={resumen.stock !== null} />
          </TarjetaBase>
        </>
      ) : null}
    </Stack>
  )
}

function BloqueVentas({ resumen }: { resumen: ResumenInicio }) {
  const ventas = resumen.ventas!
  const enlace = enlaceVentas({ desde: resumen.desde, hasta: resumen.hasta })
  const variacionMonto = variacionPorcentual(ventas.monto, ventas.anterior_monto)
  const variacionComprobantes = variacionPorcentual(ventas.comprobantes, ventas.anterior_comprobantes)
  const sinVentas = ventas.comprobantes === 0 && ventas.monto === 0 && ventas.unidades === 0
  return (
    <TarjetaBase titulo="Ventas del período">
      <Stack spacing={1.5}>
        {sinVentas ? <Typography color="text.secondary">No hay ventas en este período.</Typography> : null}
        <Box sx={GRILLA}>
          <Indicador rotulo="Ventas (con IVA)" valor={formatoPesos(ventas.monto)} detalle={detalleVariacion(variacionMonto)} tendencia={tendenciaDe(variacionMonto)} to={enlace} />
          <Indicador rotulo="Comprobantes" valor={formatoEntero(ventas.comprobantes)} detalle={detalleVariacion(variacionComprobantes)} tendencia={tendenciaDe(variacionComprobantes)} to={enlace} />
          <Indicador rotulo="Ticket promedio (con IVA)" valor={ventas.ticket_promedio === null ? '—' : formatoPesos(ventas.ticket_promedio)} detalle="Ventas / comprobantes" to={enlace} />
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
