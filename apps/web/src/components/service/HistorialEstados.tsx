import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import type { EventoHistorial } from '../../lib/reparaciones'

type Props = { eventos: EventoHistorial[]; error?: string | null; onReintentar?: () => void }

function describir(evento: EventoHistorial): string {
  switch (evento.tipo) {
    case 'alta':
      return `Ingresó en «${evento.estado_nuevo ?? ''}»${evento.nota ? ` · ${evento.nota}` : ''}`
    case 'estado':
      return `${evento.estado_anterior ?? ''} → ${evento.estado_nuevo ?? ''}`
    case 'entrega':
      return `Entregada: ${evento.estado_anterior ?? ''} → ${evento.estado_nuevo ?? ''}${evento.nota ? ` (${evento.nota})` : ''}`
    case 'anulacion':
      return `Anulada${evento.nota ? `: ${evento.nota}` : ''}`
  }
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// Historial de estados de la reparación (FR-030): estado · fecha · usuario, más reciente primero, solo lectura.
export function HistorialEstados({ eventos, error, onReintentar }: Props) {
  if (error) {
    return (
      <Alert
        severity="error"
        action={onReintentar ? <Button color="inherit" size="small" onClick={onReintentar}>Reintentar</Button> : undefined}
      >
        {error}
      </Alert>
    )
  }
  if (eventos.length === 0) return <Typography variant="body2" color="text.secondary">Todavía no hay movimientos.</Typography>
  return (
    <Stack component="ol" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Historial de estados">
      {eventos.map((evento) => (
        <Box component="li" key={evento.id}>
          <Typography variant="body2">{describir(evento)}</Typography>
          <Typography variant="caption" color="text.secondary">
            <time dateTime={evento.creado_en}>{formatoFecha.format(new Date(evento.creado_en))}</time>
            {evento.usuario ? ` · ${evento.usuario}` : ''}
          </Typography>
        </Box>
      ))}
    </Stack>
  )
}
