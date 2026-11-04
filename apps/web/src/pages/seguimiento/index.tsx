import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { consultarEstadoReparacion, type EstadoPublico, type ResultadoSeguimiento } from '../../lib/seguimientoPublico'

const ZONA = 'America/Argentina/Buenos_Aires'

// «YYYY-MM-DD» se formatea sin pasar por Date para no correrse un día por la zona horaria.
function fechaCorta(valor: string): string {
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return valor
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(fecha)
}

// La página pública no debe indexarse (FR-045): se agrega la meta mientras está montada.
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
}

function Tarjeta({ estado }: { estado: EstadoPublico }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary">{estado.tienda}</Typography>
            <Typography component="h1" variant="h5">{`Reparación ${estado.codigo}`}</Typography>
            <Typography variant="body1" color="text.secondary">{`${estado.equipo} ${estado.modelo}`}</Typography>
          </Box>
          <Box component="section" aria-labelledby="seguimiento-estado">
            <Typography id="seguimiento-estado" component="h2" variant="subtitle2" color="text.secondary">Estado actual</Typography>
            <Typography variant="h6">{estado.estado.nombre}</Typography>
            {estado.estado.descripcion ? (
              <Typography variant="body2" color="text.secondary">
                <strong>Qué significa:</strong> {estado.estado.descripcion}
              </Typography>
            ) : null}
          </Box>
          <Box>
            <Typography component="h2" variant="subtitle2" color="text.secondary">Entrega prevista</Typography>
            <Typography variant="body1">{estado.entrega_prevista ? fechaCorta(estado.entrega_prevista) : 'Sin fecha definida'}</Typography>
          </Box>
          {estado.linea_de_tiempo.length > 0 ? (
            <Box component="section" aria-labelledby="seguimiento-linea">
              <Typography id="seguimiento-linea" component="h2" variant="subtitle2" color="text.secondary">Línea de tiempo</Typography>
              <List dense disablePadding aria-label="Línea de tiempo de estados">
                {estado.linea_de_tiempo.map((punto, indice) => (
                  <ListItem key={`${punto.fecha}-${indice}`} disableGutters>
                    <ListItemText primary={punto.estado} secondary={fechaCorta(punto.fecha)} />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

// Seguimiento público de una reparación (FR-041, FR-045): fuera del panel, sin sesión, menú ni barra superior.
// Muestra solo la lista blanca que devuelve la Edge Function; nunca datos del cliente ni internos.
export function SeguimientoPage() {
  useNoIndex()
  const { token = '' } = useParams()
  const [resultado, setResultado] = useState<ResultadoSeguimiento | null>(null)

  const consultar = useCallback(() => {
    let vigente = true
    setResultado(null)
    void consultarEstadoReparacion(token).then((r) => { if (vigente) setResultado(r) })
    return () => { vigente = false }
  }, [token])

  useEffect(() => consultar(), [consultar])

  return (
    <Box component="main" sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', p: { xs: 2, sm: 3 } }}>
      <Box sx={{ width: '100%', maxWidth: 640, minWidth: 0 }}>
        {resultado === null ? (
          <Stack role="status" direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ py: 6 }}>
            <CircularProgress size={24} aria-hidden />
            <Typography>Buscando tu reparación…</Typography>
          </Stack>
        ) : null}
        {resultado?.tipo === 'ok' ? <Tarjeta estado={resultado.estado} /> : null}
        {resultado?.tipo === 'no_encontrada' ? (
          <Alert severity="info"><Typography component="h1" variant="subtitle1">No encontramos esa reparación</Typography>Revisá que el enlace esté completo o pedile uno nuevo al taller.</Alert>
        ) : null}
        {resultado?.tipo === 'demasiadas' ? (
          <Alert severity="warning"><Typography component="h1" variant="subtitle1">Demasiadas consultas, probá en unos minutos</Typography></Alert>
        ) : null}
        {resultado?.tipo === 'error' ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={consultar}>Reintentar</Button>}>
            No pudimos consultar el estado de tu reparación.
          </Alert>
        ) : null}
      </Box>
    </Box>
  )
}
