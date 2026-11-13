import { Box, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { CargaInfinita } from '../pagina/CargaInfinita'
import { detalleLegible, horaRelativa, type Notificacion } from './notificaciones'
import { SOLO_LECTORES } from '../base/solo-lectores'

type ListaNotificacionesProps = {
  items: Notificacion[]
  total: number
  cargando: boolean
  error: boolean
  errorMas: boolean
  cargada: boolean
  hayMas: boolean
  onCargarMas: () => void
  onReintentar: () => void
  onAbrir: (notificacion: Notificacion) => void
}

// Contenido del desplegable (FR-007): tipo legible, detalle en texto plano, hora relativa y no leídos
// destacados. Nunca muestra `tipo_aviso` ni `grupo_id`.
export function ListaNotificaciones({
  items, total, cargando, error, errorMas, cargada, hayMas, onCargarMas, onReintentar, onAbrir,
}: ListaNotificacionesProps) {
  if (error) return <Box sx={{ p: 2 }}><EstadoError titulo="No pudimos cargar tus notificaciones." reintentar={onReintentar} /></Box>
  if (!cargada) return <Box sx={{ p: 2 }}><EstadoCargaPagina lineas={3} /></Box>
  if (items.length === 0) return <Box sx={{ p: 2 }}><EstadoVacio titulo="No tenés notificaciones." /></Box>

  return (
    <Box>
      <Typography variant="xs" color="text.secondary" component="p" sx={{ px: 2, pt: 1 }}>
        {total === 1 ? '1 notificación' : `${total} notificaciones`}
      </Typography>
      <List dense disablePadding aria-label="Notificaciones">
        {items.map((notificacion) => {
          const sinLeer = notificacion.leido_en === null
          const detalle = detalleLegible(notificacion.datos)
          return (
            <ListItem key={notificacion.id} disablePadding>
            <ListItemButton
              onClick={() => onAbrir(notificacion)}
              sx={{ alignItems: 'flex-start', bgcolor: sinLeer ? 'action.hover' : undefined, borderBottom: 1, borderColor: 'divider' }}
            >
              <ListItemText
                primary={
                  <Typography component="span" fontWeight={sinLeer ? 700 : 400}>
                    {notificacion.tipo_nombre}
                    {sinLeer ? <Box component="span" sx={SOLO_LECTORES}> (sin leer)</Box> : null}
                  </Typography>
                }
                secondary={
                  <>
                    {detalle ? <Box component="span" sx={{ display: 'block', wordBreak: 'break-word' }}>{detalle}</Box> : null}
                    <Box component="span" sx={{ display: 'block' }}>{horaRelativa(notificacion.creado_en)}</Box>
                  </>
                }
              />
            </ListItemButton>
            </ListItem>
          )
        })}
      </List>
      <CargaInfinita hayMas={hayMas} cargando={cargando} hayError={errorMas} onCargarMas={onCargarMas} />
    </Box>
  )
}
