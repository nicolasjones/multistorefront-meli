import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { formatearImporte } from '../../lib/formatoImporte'
import { formatearFechaDocumento } from '../../lib/documentosReparacion'
import { esMesValido, formatearPorcentaje, type FilaComision } from '../../lib/comisiones'

// Selector de mes («AAAA-MM»). Un valor vacío o inválido no se propaga: el padre conserva el último mes válido.
export function SelectorMes({ valor, onCambio, etiqueta = 'Mes' }: { valor: string; onCambio: (mes: string) => void; etiqueta?: string }) {
  return (
    <TextField
      type="month"
      size="small"
      label={etiqueta}
      value={valor}
      onChange={(e) => { if (esMesValido(e.target.value)) onCambio(e.target.value) }}
      slotProps={{ inputLabel: { shrink: true } }}
      sx={{ minWidth: 180 }}
    />
  )
}

// Detalle por reparación: solo mano de obra al cliente (sin IVA), regla y comisión. Nunca costos ni márgenes.
export function TablaComisiones({ filas, etiqueta }: { filas: FilaComision[]; etiqueta: string }) {
  return (
    <TableContainer tabIndex={0} role="region" aria-label={`${etiqueta} (se desplaza)`}>
      <Table size="small" aria-label={etiqueta}>
        <TableHead>
          <TableRow>
            <TableCell>Reparación</TableCell>
            <TableCell>Entrega</TableCell>
            <TableCell>Equipo</TableCell>
            <TableCell align="right">Mano de obra</TableCell>
            <TableCell align="right">Tu parte</TableCell>
            <TableCell align="right">Regla</TableCell>
            <TableCell align="right">Comisión</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filas.map((fila) => (
            <TableRow key={`${fila.reparacion_id}`}>
              <TableCell component="th" scope="row">
                {fila.codigo}
                {fila.empresa ? <Typography component="span" variant="caption" color="text.secondary" display="block">{fila.empresa}</Typography> : null}
              </TableCell>
              <TableCell>{formatearFechaDocumento(fila.entrega_real)}</TableCell>
              <TableCell>{fila.equipo ?? '—'}</TableCell>
              <TableCell align="right">{formatearImporte(fila.base)}</TableCell>
              <TableCell align="right">{formatearPorcentaje(fila.porcentaje_reparto)}</TableCell>
              <TableCell align="right">{fila.porcentaje_regla === null ? 'Sin regla' : formatearPorcentaje(fila.porcentaje_regla)}</TableCell>
              <TableCell align="right">{formatearImporte(fila.comision, { centavos: 'si-hay' })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
