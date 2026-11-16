import { useState } from 'react'
import { Box, Button, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import {
  type AlcanceCotizacion,
  type ConfiguracionCotizacion,
  MENSAJE_UMBRAL_INVALIDO,
  OPCIONES_REDONDEO,
  TEXTO_QUIEN_CARGA,
  formatearPorcentaje,
  parsearUmbral,
  textoAlcancePorEmpresa,
} from '../../lib/cotizacion'

export type ValoresConfiguracion = ConfiguracionCotizacion

type Props = {
  configuracion: ConfiguracionCotizacion
  // Nombres reales de las empresas de la organización, para el texto del alcance «una por empresa».
  nombresEmpresas: ReadonlyArray<string>
  soloLectura: boolean
  guardando: boolean
  // Recibe lo elegido (incluido el alcance); quien monta decide si hace falta la vista previa del alcance.
  onGuardar: (valores: ValoresConfiguracion) => void
}

const aTexto = (pct: number) => formatearPorcentaje(pct)

// Tarjeta «Configuración» de la pantalla de Cotización (F-PRE-06, FR-008; Cotizacion.dc.html): alcance,
// redondeo, umbral para recalcular y aviso en Inicio. Es presentación del formulario: el alcance no se aplica
// acá (cambiarlo exige la vista previa de `DialogoAlcance`) y la validación definitiva es la de la base.
// Sin edición en «Cotización del dólar» es de solo lectura. El dueño la remonta (`key`) cuando cambia lo guardado.
export function TarjetaConfiguracion({ configuracion, nombresEmpresas, soloLectura, guardando, onGuardar }: Props) {
  const [alcance, setAlcance] = useState<AlcanceCotizacion>(configuracion.alcance)
  const [redondeo, setRedondeo] = useState(configuracion.redondeoPesos)
  const [umbral, setUmbral] = useState(aTexto(configuracion.umbralPct))
  const [aviso, setAviso] = useState(configuracion.avisoActivo)
  const [intento, setIntento] = useState(false)

  const umbralNumero = parsearUmbral(umbral)
  // El umbral tiene que ser menor a la «variación inusual» configurada: si no, la alerta nunca aparecería.
  const errorUmbral = umbralNumero === null
    ? MENSAJE_UMBRAL_INVALIDO
    : umbralNumero >= configuracion.confirmacionPct
      ? `El umbral tiene que ser menor a ${aTexto(configuracion.confirmacionPct)} %.`
      : null
  const mostrarErrorUmbral = intento && errorUmbral !== null

  const guardar = () => {
    setIntento(true)
    if (errorUmbral !== null || umbralNumero === null) return
    onGuardar({ ...configuracion, alcance, redondeoPesos: redondeo, umbralPct: umbralNumero, avisoActivo: aviso })
  }

  return (
    <Box component="section" aria-labelledby="titulo-configuracion-cotizacion" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2.5 }}>
      <Typography id="titulo-configuracion-cotizacion" component="h2" variant="t3" sx={{ mb: 2 }}>Configuración</Typography>
      <Stack spacing={2}>
        <Stack spacing={0.75}>
          <Typography id="etiqueta-alcance-cotizacion" variant="s" sx={{ fontWeight: 600 }}>Alcance</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            disabled={soloLectura}
            aria-labelledby="etiqueta-alcance-cotizacion"
            value={alcance}
            onChange={(_, nuevo: AlcanceCotizacion | null) => { if (nuevo) setAlcance(nuevo) }}
            sx={{ flexWrap: 'wrap' }}
          >
            <ToggleButton value="sistema">Una para todo el sistema</ToggleButton>
            <ToggleButton value="empresa">Una por empresa</ToggleButton>
          </ToggleButtonGroup>
          {alcance === 'empresa' && nombresEmpresas.length > 0 ? (
            <Typography variant="xs">{textoAlcancePorEmpresa(nombresEmpresas)}</Typography>
          ) : null}
        </Stack>

        <TextField
          select
          label="Redondeo del precio en pesos"
          value={redondeo}
          onChange={(evento) => setRedondeo(Number(evento.target.value))}
          disabled={soloLectura}
          slotProps={{ select: { native: true } }}
          fullWidth
        >
          {OPCIONES_REDONDEO.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
          ))}
        </TextField>

        <TextField
          label="Umbral para recalcular"
          value={umbral}
          onChange={(evento) => setUmbral(evento.target.value.replace(/[^0-9.,]/g, ''))}
          disabled={soloLectura}
          error={mostrarErrorUmbral}
          helperText={mostrarErrorUmbral ? errorUmbral : 'Si la variación es menor, se registra el valor pero no se tocan los precios.'}
          slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' }, input: { endAdornment: <Typography variant="s" component="span">%</Typography> } }}
          fullWidth
        />

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
          <Box>
            <Typography id="etiqueta-aviso-inicio" variant="b" sx={{ fontWeight: 600 }}>Aviso en Inicio</Typography>
            <Typography variant="xs" component="p">Mostrar alerta si no se cargó la cotización del día.</Typography>
          </Box>
          <Switch
            checked={aviso}
            onChange={(evento) => setAviso(evento.target.checked)}
            disabled={soloLectura}
            slotProps={{ input: { 'aria-labelledby': 'etiqueta-aviso-inicio' } }}
          />
        </Stack>

        <Typography variant="xs" sx={{ bgcolor: 'action.hover', borderRadius: 2, px: 1.5, py: 1 }}>{TEXTO_QUIEN_CARGA}</Typography>

        <Box>
          <Button variant="outlined" size="small" onClick={guardar} disabled={soloLectura || guardando}>
            {guardando ? 'Guardando…' : 'Guardar configuración'}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
