import { useCallback } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, LinearProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { EstadoVacio } from '../../../components/estados/EstadosPagina'
import { etiquetaTipoActividad, formatearCuando, tiendaDelEvento } from '../../../lib/actividad'
import {
  leerActividadReciente, leerBloquesInicio, type BloquesInicio, type ContextoTablero, type DepositoSalidas, type TiendaResumen,
} from '../../../lib/inicioBloques'
import { formatoEntero, formatoPesos } from '../../../lib/inicioTablero'
import { TarjetaInicio } from '../TarjetaInicio'
import { useLecturaInicio } from '../useLecturaInicio'

const GRILLA = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }

type Props = { contexto: ContextoTablero; verVentas: boolean; verStock: boolean; verActividad: boolean }

// Bloques de gestión de Inicio (F-INI-05, MSF-821): «Qué hacer hoy» (alertas de MSF-361) ya se monta arriba en
// la página de Inicio; acá van «Resumen por tienda», «Salidas por depósito» y «Actividad reciente». Respetan los filtros del tablero y cada
// uno tiene su estado de carga, vacío y error. Un bloque sin permiso ni se muestra ni se consulta (FR-011).
// «Resumen por tienda» y «Salidas por depósito» salen de la MISMA lectura (`resumen_inicio_bloques`).
export function BloquesGestion({ contexto, verVentas, verStock, verActividad }: Props) {
  const { desde, hasta, empresaId, depositoId } = contexto
  const clave = `${desde}|${hasta}|${empresaId ?? ''}|${depositoId ?? ''}`
  const leerBloques = useCallback(
    async () => ({ clave, bloques: await leerBloquesInicio({ desde, hasta, empresaId, depositoId }) }),
    [clave, desde, hasta, empresaId, depositoId],
  )
  const bloques = useLecturaInicio(leerBloques, { habilitado: verVentas || verStock })
  const actual: BloquesInicio | null = bloques.datos !== null && bloques.datos.clave === clave ? bloques.datos.bloques : null
  const cargandoBloques = bloques.cargando || (!bloques.hayError && actual === null)

  return (
    <Box sx={GRILLA}>
      {verVentas ? (
        <TarjetaInicio titulo="Resumen por tienda" cargando={cargandoBloques} hayError={bloques.hayError} onReintentar={() => void bloques.recargar()}>
          {actual?.por_tienda ? <ResumenPorTienda tiendas={actual.por_tienda} /> : null}
        </TarjetaInicio>
      ) : null}
      {verStock ? (
        <TarjetaInicio titulo="Salidas por depósito" cargando={cargandoBloques} hayError={bloques.hayError} onReintentar={() => void bloques.recargar()}>
          {actual?.salidas_por_deposito ? <SalidasPorDeposito depositos={actual.salidas_por_deposito} /> : null}
        </TarjetaInicio>
      ) : null}
      {verActividad ? <ActividadReciente contexto={contexto} /> : null}
    </Box>
  )
}

function ResumenPorTienda({ tiendas }: { tiendas: TiendaResumen[] }) {
  if (tiendas.length === 0) return <EstadoVacio titulo="No hay tiendas para mostrar" descripcion="No hay tiendas activas con ventas habilitadas para tu rol." />
  const maximo = Math.max(1, ...tiendas.map((tienda) => tienda.unidades))
  return (
    <List disablePadding aria-label="Resumen por tienda">
      {tiendas.map((tienda) => (
        <ListItem key={tienda.empresa_id} disableGutters sx={{ display: 'block' }}>
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography fontWeight={600}>{tienda.nombre}</Typography>
            <Typography>{formatoEntero(tienda.unidades)} u.</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={Math.max(0, (tienda.unidades / maximo) * 100)} aria-label={`Unidades de ${tienda.nombre}`} sx={{ my: 0.5 }} />
          {tienda.ingresos !== null || tienda.margen_pct !== null ? (
            <Typography variant="body2" color="text.secondary">
              {tienda.ingresos !== null ? `Ingresos (con IVA): ${formatoPesos(tienda.ingresos)}` : null}
              {tienda.ingresos !== null && tienda.margen_pct !== null ? ' · ' : null}
              {tienda.margen_pct !== null ? `Margen estimado: ${tienda.margen_pct.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %` : null}
              {tienda.ingresos !== null && tienda.margen_pct === null ? ' · Margen estimado: sin costo cargado' : null}
            </Typography>
          ) : null}
        </ListItem>
      ))}
    </List>
  )
}

function SalidasPorDeposito({ depositos }: { depositos: DepositoSalidas[] }) {
  if (depositos.length === 0) return <EstadoVacio titulo="No hay depósitos para mostrar" />
  const maximo = Math.max(1, ...depositos.map((deposito) => deposito.salidas))
  return (
    <List disablePadding aria-label="Salidas por depósito">
      {depositos.map((deposito) => (
        <ListItem key={deposito.deposito_id} disableGutters sx={{ display: 'block' }}>
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography fontWeight={600}>{deposito.nombre}</Typography>
            <Typography>{formatoEntero(deposito.salidas)} u.</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={Math.max(0, (deposito.salidas / maximo) * 100)} aria-label={`Salidas de ${deposito.nombre}`} sx={{ my: 0.5 }} />
          <Typography variant="body2" color="text.secondary">Stock actual: {formatoEntero(deposito.stock_actual)} u.</Typography>
        </ListItem>
      ))}
    </List>
  )
}

function ActividadReciente({ contexto }: { contexto: ContextoTablero }) {
  const { desde, hasta, empresaId, depositoId } = contexto
  const clave = `${desde}|${hasta}|${empresaId ?? ''}`
  const leer = useCallback(
    async () => ({ clave, eventos: await leerActividadReciente({ desde, hasta, empresaId, depositoId }) }),
    [clave, desde, hasta, empresaId, depositoId],
  )
  const lectura = useLecturaInicio(leer)
  const eventos = lectura.datos !== null && lectura.datos.clave === clave ? lectura.datos.eventos : null
  const cargando = lectura.cargando || (!lectura.hayError && eventos === null)
  return (
    <TarjetaInicio titulo="Actividad reciente" cargando={cargando} hayError={lectura.hayError} onReintentar={() => void lectura.recargar()}>
      {eventos === null ? null : eventos.length === 0 ? (
        <EstadoVacio titulo="Sin actividad en este período" descripcion="Cuando haya movimientos, cambios de precio o del dólar aparecen acá." />
      ) : (
        <>
          <List disablePadding aria-label="Actividad reciente">
            {eventos.map((evento) => (
              <ListItem
                key={evento.id}
                disableGutters
                secondaryAction={<Button component={RouterLink} to="/actividad" size="small" aria-label={`Ver en Actividad: ${evento.detalle}`}>Ver</Button>}
              >
                <ListItemText
                  sx={{ pr: 6 }}
                  primary={`${etiquetaTipoActividad(evento.tipo)} · ${evento.detalle}`}
                  secondary={`${formatearCuando(evento.creadoEn)} · ${evento.actorNombre ?? 'Sistema'} · ${tiendaDelEvento(evento.empresaNombre, evento.empresaId)}`}
                />
              </ListItem>
            ))}
          </List>
          <Button component={RouterLink} to="/actividad" size="small" sx={{ mt: 1 }}>Ver todo</Button>
        </>
      )}
    </TarjetaInicio>
  )
}
