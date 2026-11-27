import { useState } from 'react'
import { Alert, Box, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { useCargaComisiones } from '../../hooks/useCargaComisiones'
import { comisionesDeTecnico, comisionesResumen, mesActual, rangoDelMes } from '../../lib/comisiones'
import { formatearImporte } from '../../lib/formatoImporte'
import { SelectorMes, TablaComisiones } from './TablaComisiones'

// Comisiones de todos los técnicos del mes (MSF-957: exige «Ver comisiones», que no depende de «Ver costos»). Respeta las
// tiendas accesibles de quien mira. «Empresa activa: no aplica»: compara técnicos de toda la organización.
export function ComisionesEquipo() {
  const [mes, setMes] = useState(() => mesActual())
  const { desde, hasta } = rangoDelMes(mes)
  const { datos, cargando, error, recargar } = useCargaComisiones(mes, () => comisionesResumen(desde, hasta), 'No pudimos cargar las comisiones del equipo.')
  // Detalle abierto: se descarta al cambiar de mes (la clave del detalle incluye el mes).
  const [abierto, setAbierto] = useState<{ mes: string; tecnicoId: string | null; nombre: string } | null>(null)
  const detalleVisible = abierto && abierto.mes === mes ? abierto : null

  return (
    <Stack spacing={2}>
      <SelectorMes valor={mes} onCambio={setMes} />
      {cargando ? <EstadoCargaPagina lineas={3} etiqueta="Cargando las comisiones del equipo" /> : null}
      {error ? <EstadoError titulo={error} reintentar={recargar} /> : null}
      {datos ? (
        <>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap role="group" aria-label="Totales del mes">
            <Stack>
              <Typography variant="caption" color="text.secondary">Comisiones del mes</Typography>
              <Typography variant="h4" component="p">{formatearImporte(datos.total, { centavos: 'si-hay' })}</Typography>
            </Stack>
            <Stack>
              <Typography variant="caption" color="text.secondary">Reparaciones entregadas</Typography>
              <Typography variant="h4" component="p">{datos.reparaciones}</Typography>
            </Stack>
          </Stack>
          {datos.sin_regla > 0 ? (
            <Alert severity="warning">
              {datos.sin_regla} {datos.sin_regla === 1 ? 'participación no tiene' : 'participaciones no tienen'} una regla de comisión vigente a la fecha de entrega: sin comisión. Cargá una regla en la pestaña «Reglas».
            </Alert>
          ) : null}
          {datos.tecnicos.length === 0 ? (
            <EstadoVacio titulo="No hay comisiones en este mes." />
          ) : (
            <TableContainer tabIndex={0} role="region" aria-label="Comisiones por técnico (se desplaza)">
              <Table size="small" aria-label="Comisiones por técnico">
                <TableHead>
                  <TableRow>
                    <TableCell>Técnico</TableCell>
                    <TableCell align="right">Reparaciones</TableCell>
                    <TableCell align="right">Mano de obra</TableCell>
                    <TableCell align="right">Comisión</TableCell>
                    <TableCell align="right">Detalle</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {datos.tecnicos.map((t) => (
                    <TableRow key={t.tecnico_id ?? 'baja'}>
                      <TableCell component="th" scope="row">{t.nombre}</TableCell>
                      <TableCell align="right">{t.reparaciones}</TableCell>
                      <TableCell align="right">{formatearImporte(t.base)}</TableCell>
                      <TableCell align="right">{formatearImporte(t.comision, { centavos: 'si-hay' })}</TableCell>
                      <TableCell align="right">
                        {t.tecnico_id ? (
                          <Button size="small" aria-label={`Ver detalle de ${t.nombre}`} onClick={() => setAbierto({ mes, tecnicoId: t.tecnico_id, nombre: t.nombre })}>
                            Ver detalle
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      ) : null}
      {detalleVisible && detalleVisible.tecnicoId ? (
        <DetalleTecnico key={`${detalleVisible.tecnicoId}-${mes}`} tecnicoId={detalleVisible.tecnicoId} nombre={detalleVisible.nombre} desde={desde} hasta={hasta} onCerrar={() => setAbierto(null)} />
      ) : null}
      <Typography variant="caption" color="text.secondary">Es una estimación para liquidar: no registra pagos.</Typography>
    </Stack>
  )
}

function DetalleTecnico({ tecnicoId, nombre, desde, hasta, onCerrar }: { tecnicoId: string; nombre: string; desde: string; hasta: string; onCerrar: () => void }) {
  const { datos, cargando, error, recargar } = useCargaComisiones(`${tecnicoId}|${desde}`, () => comisionesDeTecnico(tecnicoId, desde, hasta), 'No pudimos cargar el detalle del técnico.')
  return (
    <Box component="section" aria-labelledby="titulo-detalle-tecnico" sx={{ border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography id="titulo-detalle-tecnico" component="h3" variant="t3">Detalle de {nombre}</Typography>
        <Button size="small" onClick={onCerrar}>Cerrar detalle</Button>
      </Stack>
      {cargando ? <EstadoCargaPagina lineas={2} etiqueta="Cargando el detalle" /> : null}
      {error ? <EstadoError titulo={error} reintentar={recargar} /> : null}
      {datos ? (
        <Stack spacing={1}>
          <Typography variant="body2">Total: <strong>{formatearImporte(datos.total, { centavos: 'si-hay' })}</strong> en {datos.reparaciones} {datos.reparaciones === 1 ? 'reparación' : 'reparaciones'}.</Typography>
          {datos.filas.length === 0 ? <EstadoVacio titulo="Sin reparaciones en este mes." /> : <TablaComisiones filas={datos.filas} etiqueta={`Detalle de comisiones de ${nombre}`} />}
        </Stack>
      ) : null}
    </Box>
  )
}
