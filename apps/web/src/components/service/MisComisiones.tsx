import { useState } from 'react'
import { Alert, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { useCargaComisiones } from '../../hooks/useCargaComisiones'
import { mesActual, misComisiones, rangoDelMes } from '../../lib/comisiones'
import { formatearImporte } from '../../lib/formatoImporte'
import { SelectorMes, TablaComisiones } from './TablaComisiones'

const MENSAJE_ERROR = 'No pudimos cargar tus comisiones.'

// «Mis comisiones» (MSF-954): lo del propio técnico en el mes elegido. El usuario sale de la sesión en la base (no se envía);
// no muestra costos, márgenes ni lo de otros técnicos. Es una estimación para liquidar: no registra pagos.
export function MisComisiones() {
  const [mes, setMes] = useState(() => mesActual())
  const { desde, hasta } = rangoDelMes(mes)
  const { datos, cargando, error, recargar } = useCargaComisiones(mes, () => misComisiones(desde, hasta), MENSAJE_ERROR)

  return (
    <Stack spacing={2}>
      <SelectorMes valor={mes} onCambio={setMes} />
      {cargando ? <EstadoCargaPagina lineas={3} etiqueta="Cargando tus comisiones" /> : null}
      {error ? <EstadoError titulo={error} reintentar={recargar} /> : null}
      {datos ? (
        <>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap role="group" aria-label="Resumen del mes">
            <Stack>
              <Typography variant="caption" color="text.secondary">Tu comisión del mes</Typography>
              <Typography variant="h4" component="p" data-testid="total-comision">{formatearImporte(datos.total, { centavos: 'si-hay' })}</Typography>
            </Stack>
            <Stack>
              <Typography variant="caption" color="text.secondary">Reparaciones entregadas</Typography>
              <Typography variant="h4" component="p">{datos.reparaciones}</Typography>
            </Stack>
          </Stack>
          {datos.sin_regla > 0 ? (
            <Alert severity="info">
              {datos.sin_regla === 1 ? '1 reparación no tiene' : `${datos.sin_regla} reparaciones no tienen`} una regla de comisión vigente a su fecha de entrega: figura con comisión $ 0. Consultá con el taller.
            </Alert>
          ) : null}
          {datos.truncado ? <Alert severity="warning">Hay más de 1.000 reparaciones en el mes: se muestran las 1.000 más recientes. El total incluye todas.</Alert> : null}
          {datos.filas.length === 0 ? (
            <EstadoVacio titulo="No tenés comisiones en este mes." descripcion="Aparecen las reparaciones entregadas en el mes en las que participás como técnico." />
          ) : (
            <TablaComisiones filas={datos.filas} etiqueta="Detalle de tus comisiones por reparación" />
          )}
          <Typography variant="caption" color="text.secondary">
            La comisión es una estimación para liquidar: no registra pagos. Se calcula sobre la mano de obra al cliente, sin IVA.
          </Typography>
        </>
      ) : null}
    </Stack>
  )
}
