import { useMemo, useState } from 'react'
import { Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import {
  ATAJO_RANGO_INICIAL,
  ATAJOS_RANGO,
  rangoEsValido,
  rangoPorAtajo,
  type AtajoRango,
  type RangoFechas,
} from '../../lib/ventas-reportes'

type Props = {
  rango: RangoFechas
  onCambiar: (rango: RangoFechas) => void
}

// Filtros de período del prototipo (VentasReportes.dc.html): «Desde» y «Hasta» con los atajos
// «Hoy», «7 días», «Este mes» y «Mes anterior». Un rango inválido se avisa en el campo y NO se
// aplica: el tablero sigue mostrando el último período válido (nunca se consulta un rango roto).
export function FiltrosPeriodo({ rango, onCambiar }: Props) {
  // El período vive acá: el padre solo recibe el rango válido que se aplica (el tablero lo consulta).
  const [desde, setDesde] = useState(rango.desde)
  const [hasta, setHasta] = useState(rango.hasta)
  const [atajo, setAtajo] = useState<AtajoRango | null>(ATAJO_RANGO_INICIAL)

  const error = useMemo(() => {
    if (desde === '' || hasta === '') return 'Indicá las dos fechas.'
    if (!rangoEsValido({ desde, hasta })) return 'Hasta no puede ser anterior a Desde.'
    return null
  }, [desde, hasta])

  const aplicar = (nuevo: RangoFechas) => {
    if (!rangoEsValido(nuevo)) return
    onCambiar(nuevo)
  }

  const elegirAtajo = (valor: AtajoRango | null) => {
    if (valor === null) return
    const nuevo = rangoPorAtajo(valor)
    setDesde(nuevo.desde)
    setHasta(nuevo.hasta)
    setAtajo(valor)
    aplicar(nuevo)
  }

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      alignItems={{ sm: 'flex-end' }}
      useFlexGap
      flexWrap="wrap"
    >
      <TextField
        type="date"
        label="Desde"
        size="small"
        value={desde}
        onChange={(evento) => {
          setDesde(evento.target.value)
          setAtajo(null)
          aplicar({ desde: evento.target.value, hasta })
        }}
        error={Boolean(error)}
        helperText={error ?? ' '}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        type="date"
        label="Hasta"
        size="small"
        value={hasta}
        onChange={(evento) => {
          setHasta(evento.target.value)
          setAtajo(null)
          aplicar({ desde, hasta: evento.target.value })
        }}
        error={Boolean(error)}
        helperText={error ?? ' '}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label="Atajos de período"
        value={atajo ?? ''}
        onChange={(_, valor: AtajoRango | null) => elegirAtajo(valor)}
      >
        {ATAJOS_RANGO.map((opcion) => (
          <ToggleButton key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  )
}
