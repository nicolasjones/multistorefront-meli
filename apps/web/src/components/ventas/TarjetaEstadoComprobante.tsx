import { Alert, Chip, Card, CardContent, CardHeader, Stack, Tooltip, Typography } from '@mui/material'
import { tokens } from '../../tema/tokens'
import {
  ESTADOS_DE_LA_TARJETA,
  definicionEstado,
  motivoDeshabilitado,
  type EstadoComprobante,
} from '../../lib/estadosComprobante'

// Tarjeta «Estado» del detalle (F-VTA-10, FR-024): un chip por estado del panel, el texto de ayuda del estado actual
// y deshabilitados —con su motivo— los que el rol no puede elegir. La autoridad es la base (`permitidos` sale de
// `transiciones_permitidas_comprobante`; el cambio lo valida `cambiar_estado_comprobante`).

type Props = {
  estado: string
  permitidos: ReadonlyArray<string>
  ocupado: boolean
  error: string | null
  onElegir: (estado: EstadoComprobante) => void
}

export function TarjetaEstadoComprobante({ estado, permitidos, ocupado, error, onElegir }: Props) {
  const actual = definicionEstado(estado)
  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-estado-comprobante">
      <CardHeader title={<Typography id="titulo-estado-comprobante" component="h2" variant="t3">Estado</Typography>} />
      <CardContent>
        <Stack spacing={1.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Estado del comprobante">
            {ESTADOS_DE_LA_TARJETA.map((destino) => {
              const definicion = definicionEstado(destino)
              const seleccionado = actual.etiqueta === definicion.etiqueta
              const motivo = seleccionado ? null : motivoDeshabilitado(estado, destino, permitidos)
              const deshabilitado = !seleccionado && (motivo !== null || ocupado)
              const tono = tokens.color.etiqueta[definicion.tono]
              const chip = (
                <Chip
                  label={definicion.etiqueta}
                  component="button"
                  type="button"
                  clickable
                  disabled={deshabilitado}
                  aria-pressed={seleccionado}
                  aria-label={motivo ? `${definicion.etiqueta}. ${motivo}` : definicion.etiqueta}
                  onClick={seleccionado ? undefined : () => onElegir(destino)}
                  sx={{
                    backgroundColor: tono.fondo,
                    color: tono.texto,
                    fontWeight: 600,
                    ...(seleccionado ? { outline: `2px solid ${tono.texto}`, outlineOffset: 1 } : {}),
                  }}
                />
              )
              // El chip deshabilitado no recibe foco ni hover: el motivo viaja en `aria-label` y en el tooltip del contenedor.
              return motivo ? (
                <Tooltip key={destino} title={motivo}>
                  <span>{chip}</span>
                </Tooltip>
              ) : (
                <span key={destino}>{chip}</span>
              )
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p">
            {actual.ayuda}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}
