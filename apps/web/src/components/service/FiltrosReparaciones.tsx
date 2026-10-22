import { useEffect, useState } from 'react'
import { MenuItem, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { PERIODOS_REPARACIONES, type PeriodoReparaciones } from '../../lib/reparacionesListado'
import type { Tecnico } from '../../lib/reparaciones'

const ESPERA_BUSQUEDA_MS = 300

type FiltrosReparacionesProps = {
  periodo: PeriodoReparaciones
  onPeriodo: (periodo: PeriodoReparaciones) => void
  serie: string
  onSerie: (serie: string) => void
  tecnicoId: string
  onTecnico: (tecnicoId: string) => void
  tecnicos: Tecnico[]
}

// Filtros del listado de reparaciones (F-SVC-04): chips Hoy/Semana/Mes, buscador por N.º de serie con
// espera de tipeo y selector de técnico. Solo disposición: el estado vive en la pantalla.
export function FiltrosReparaciones({ periodo, onPeriodo, serie, onSerie, tecnicoId, onTecnico, tecnicos }: FiltrosReparacionesProps) {
  const [texto, setTexto] = useState(serie)

  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto !== serie) onSerie(texto)
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, serie, onSerie])

  return (
    <>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label="Período de entrega prevista"
        value={periodo}
        onChange={(_, valor: PeriodoReparaciones | null) => {
          if (valor !== null) onPeriodo(valor)
        }}
      >
        {PERIODOS_REPARACIONES.map((opcion) => <ToggleButton key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</ToggleButton>)}
      </ToggleButtonGroup>
      <TextField
        type="search"
        size="small"
        label="Buscar por N.º de serie"
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        sx={{ width: 240, maxWidth: '100%' }}
      />
      <TextField
        select
        size="small"
        label="Técnico"
        value={tecnicoId}
        onChange={(evento) => onTecnico(evento.target.value)}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="">Todos los técnicos</MenuItem>
        {tecnicos.map((tecnico) => <MenuItem key={tecnico.user_id} value={tecnico.user_id}>{tecnico.nombre}</MenuItem>)}
      </TextField>
    </>
  )
}
