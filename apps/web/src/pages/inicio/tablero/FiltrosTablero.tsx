import { useState, type ReactNode } from 'react'
import { MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { DepositoOpcion } from '../../../lib/depositos'
import type { RangoFechas } from '../../../lib/ventas-reportes'
import { OPCIONES_PERIODO, errorDeRango, type ClavePeriodo, type FiltrosTablero } from './filtros'

type Props = {
  filtros: FiltrosTablero
  onPeriodo: (periodo: ClavePeriodo, rango?: RangoFechas) => void
  // Filtro de tienda: lo arma el tablero con `FiltroEmpresa` (el componente compartido) y la empresa activa.
  tienda: ReactNode
  // null = no se muestra el filtro (rol sin lectura de stock ni ventas, o los depósitos no cargaron).
  depositos: ReadonlyArray<DepositoOpcion> | null
  onDeposito: (depositoId: string | null) => void
}

const TODOS = 'todos'

// Barra de filtros de Inicio (F-INI-04, FR-001): Período, Tienda y Depósito. Un rango libre inválido se avisa
// en el campo y NO se aplica: el tablero sigue con el último período válido (nunca se consulta un rango roto).
export function FiltrosTablero({
  filtros, onPeriodo, tienda, depositos, onDeposito,
}: Props) {
  const [desde, setDesde] = useState(filtros.rango.desde)
  const [hasta, setHasta] = useState(filtros.rango.hasta)
  const errorLocal = desde === '' && hasta === '' ? null : errorDeRango({ desde, hasta })
  const error = filtros.periodo === 'rango' ? (errorLocal ?? filtros.errorRango) : null

  const cambiarFecha = (nuevo: RangoFechas) => {
    setDesde(nuevo.desde)
    setHasta(nuevo.hasta)
    if (errorDeRango(nuevo) === null) onPeriodo('rango', nuevo)
  }

  return (
    <Stack spacing={1.5} component="section" aria-label="Filtros de Inicio">
      <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography component="span" variant="s" sx={{ fontWeight: 600 }}>Período</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label="Período"
          value={filtros.periodo}
          onChange={(_, nuevo: ClavePeriodo | null) => {
            if (nuevo === null) return
            if (nuevo === 'rango') {
              const base = { desde: desde || filtros.rango.desde, hasta: hasta || filtros.rango.hasta }
              setDesde(base.desde)
              setHasta(base.hasta)
              onPeriodo('rango', base)
              return
            }
            onPeriodo(nuevo)
          }}
          sx={{ flexWrap: 'wrap' }}
        >
          {OPCIONES_PERIODO.map((opcion) => (
            <ToggleButton key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {filtros.periodo === 'rango' ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <TextField
              type="date"
              label="Desde"
              size="small"
              value={desde}
              onChange={(evento) => cambiarFecha({ desde: evento.target.value, hasta })}
              slotProps={{ inputLabel: { shrink: true } }}
              error={error !== null}
            />
            <TextField
              type="date"
              label="Hasta"
              size="small"
              value={hasta}
              onChange={(evento) => cambiarFecha({ desde, hasta: evento.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              error={error !== null}
              helperText={error}
            />
          </Stack>
        ) : null}
      </Stack>

      {tienda}

      {depositos !== null && depositos.length > 0 ? (
        <TextField
          select
          size="small"
          label="Depósito"
          value={filtros.depositoId ?? TODOS}
          onChange={(evento) => onDeposito(evento.target.value === TODOS ? null : evento.target.value)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value={TODOS}>Todos los depósitos</MenuItem>
          {depositos.map((deposito) => (
            <MenuItem key={deposito.id} value={deposito.id}>{deposito.nombre}</MenuItem>
          ))}
        </TextField>
      ) : null}
    </Stack>
  )
}
