import { Alert, Box, Button, Card, CardContent, CardHeader, CircularProgress, Stack, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { MENSAJE_CLIENTE_SIN_CORREO, type AvisoReparacion, type EstadoEnvioAviso } from '../../lib/reparacionAvisos'

type Props = {
  avisos: AvisoReparacion[]
  cargando: boolean
  error: string | null
  onReintentar: () => void
  // «Reenviar» solo con edición y cliente con correo; la RPC rechaza reparaciones anuladas (FR-027).
  puedeReenviar: boolean
  avisando: boolean
  onReenviar: (estadoId: string) => void
  // El cliente no tiene correo: se avisa en la sección (FR-023).
  sinCorreo: boolean
}

const ETIQUETA: Record<EstadoEnvioAviso, { texto: string; variante: 'aviso' | 'exito' | 'error' }> = {
  pendiente: { texto: 'Pendiente', variante: 'aviso' },
  enviado: { texto: 'Enviado', variante: 'exito' },
  fallido: { texto: 'Fallido', variante: 'error' },
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// Sección «Avisos al cliente» del detalle de la reparación (F-SVC-14, FR-026, FR-027): historial con Pendiente /
// Enviado / Fallido, destinatario, fecha y quién lo pidió, y «Reenviar» con edición. Visible con `lectura`.
export function AvisosReparacion({ avisos, cargando, error, onReintentar, puedeReenviar, avisando, onReenviar, sinCorreo }: Props) {
  return (
    <Card component="section" aria-labelledby="titulo-avisos-reparacion">
      <CardHeader title={<Typography id="titulo-avisos-reparacion" component="h2" variant="t3">Avisos al cliente</Typography>} />
      <CardContent>
        <Stack spacing={1.5}>
          {sinCorreo ? <Alert severity="warning">{MENSAJE_CLIENTE_SIN_CORREO}</Alert> : null}
          {cargando && avisos.length === 0 ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status" aria-live="polite">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Cargando los avisos…</Typography>
            </Stack>
          ) : error ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={onReintentar}>Reintentar</Button>}>
              {error}
            </Alert>
          ) : avisos.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Todavía no se avisó al cliente.</Typography>
          ) : (
            <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Historial de avisos">
              {avisos.map((aviso) => {
                const etiqueta = ETIQUETA[aviso.estado_envio]
                return (
                  <Stack
                    key={aviso.id}
                    component="li"
                    direction="row"
                    spacing={2}
                    rowGap={1}
                    flexWrap="wrap"
                    alignItems="center"
                  >
                    <EtiquetaEstado texto={etiqueta.texto} variante={etiqueta.variante} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2">{`Estado «${aviso.estado_nombre}» · ${aviso.destinatario}`}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`${formatoFecha.format(new Date(aviso.solicitado_en))}${aviso.solicitado_por_nombre ? ` · pidió ${aviso.solicitado_por_nombre}` : ''}`}
                        {aviso.estado_envio === 'fallido' && aviso.error ? ` · ${aviso.error}` : ''}
                      </Typography>
                    </Box>
                    {puedeReenviar && aviso.estado_envio !== 'pendiente' ? (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={avisando}
                        onClick={() => onReenviar(aviso.estado_id)}
                        aria-label={`Reenviar aviso del estado ${aviso.estado_nombre}`}
                      >
                        Reenviar
                      </Button>
                    ) : null}
                  </Stack>
                )
              })}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
