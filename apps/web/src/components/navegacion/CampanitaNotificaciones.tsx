import { useState } from 'react'
import { Badge, Box, Button, Divider, IconButton, Popover, Stack, Typography } from '@mui/material'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import { supabaseClient } from '../../lib/supabase'
import { tokens } from '../../tema/tokens'
import { ListaNotificaciones } from './ListaNotificaciones'
import type { Notificacion } from './notificaciones'
import { useConteoSinLeer, useListaNotificaciones } from './useNotificaciones'

// F-NOT-02 (MSF-378): campanita de la barra superior. Lee los avisos propios de la sesión
// (`public.avisos_pendientes` por RPC `security definer`). Empresa activa: no aplica (avisos personales).
export function CampanitaNotificaciones() {
  const [ancla, setAncla] = useState<HTMLButtonElement | null>(null)
  const abierta = ancla !== null
  const [falloMarcar, setFalloMarcar] = useState(false)
  const { conteo, setConteo, refrescar } = useConteoSinLeer()
  const lista = useListaNotificaciones(abierta)

  const abrir = (evento: React.MouseEvent<HTMLButtonElement>) => {
    setAncla(evento.currentTarget)
    setFalloMarcar(false)
    void refrescar()
  }

  const marcar = async (ids: string[] | null) => {
    setFalloMarcar(false)
    const { error } = await supabaseClient.rpc('marcar_notificaciones_leidas', { p_ids: ids })
    if (error) {
      setFalloMarcar(true)
      void refrescar()
      return
    }
    lista.marcarLocal(ids)
    if (ids === null) setConteo(0)
    else void refrescar()
  }

  const abrirAviso = (notificacion: Notificacion) => {
    if (notificacion.leido_en === null) {
      setConteo((actual) => Math.max(0, actual - 1))
      void marcar([notificacion.id])
    }
  }

  const etiqueta = conteo > 0 ? `Notificaciones, ${conteo} sin leer` : 'Notificaciones'

  return (
    <>
      <IconButton aria-label={etiqueta} aria-haspopup="dialog" aria-expanded={abierta} onClick={abrir} size="large">
        <Badge
          variant="dot"
          invisible={conteo === 0}
          sx={{ '& .MuiBadge-badge': { bgcolor: tokens.color.peligro, border: `2px solid ${tokens.color.superficie}`, width: 12, height: 12, borderRadius: '50%' } }}
        >
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>
      <Popover
        open={abierta}
        anchorEl={ancla}
        onClose={() => setAncla(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': 'Notificaciones', sx: { width: 'min(400px, calc(100vw - 16px))', maxHeight: '70vh' } } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
          <Typography component="h2" variant="h6">Notificaciones</Typography>
          <Button size="small" disabled={conteo === 0} onClick={() => { void marcar(null) }}>Marcar todas como leídas</Button>
        </Stack>
        <Divider />
        {falloMarcar ? (
          <Box role="alert" sx={{ px: 2, py: 1 }}>
            <Typography variant="s" color="error">No pudimos marcar las notificaciones. Probá de nuevo.</Typography>
          </Box>
        ) : null}
        <ListaNotificaciones
          items={lista.items}
          total={lista.total}
          cargando={lista.cargando}
          error={lista.error}
          errorMas={lista.errorMas}
          cargada={lista.cargada}
          hayMas={lista.hayMas}
          onCargarMas={lista.cargarMas}
          onReintentar={lista.recargar}
          onAbrir={abrirAviso}
        />
      </Popover>
    </>
  )
}
