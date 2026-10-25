import { useEffect } from 'react'
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material'
import {
  TIPOGRAFIAS, esColorValido, evaluarContraste, familiasACargar, urlFuentes, type Tipografia,
} from '../../../../../lib/tiendaIdentidad'
import { tokens } from '../../../../../tema/tokens'

// F-TDA-02 (FR-022, FR-023, FR-024): campos de color con muestra y validación, aviso de contraste AA y
// selector de tipografías desde la lista cerrada de DS-04.

const AYUDA_COLOR = 'Usá el formato #RRGGBB, por ejemplo #A3111D.' // estilos-sueltos: ok: texto de ayuda con el formato del color, no es un estilo

export function CampoColor({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
}) {
  const invalido = !esColorValido(valor)
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        aria-hidden="true"
        data-testid={`muestra-${etiqueta}`}
        sx={{
          width: (tema) => tema.spacing(5.5),
          height: (tema) => tema.spacing(5.5),
          mt: 0.5,
          flexShrink: 0,
          borderRadius: (tema) => tema.shape.borderRadius,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: invalido ? 'transparent' : valor.trim(),
        }}
      />
      <TextField
        label={etiqueta}
        value={valor}
        onChange={(evento) => onChange(evento.target.value)}
        error={invalido}
        helperText={invalido ? AYUDA_COLOR : ' '}
        size="small"
        fullWidth
        slotProps={{ htmlInput: { maxLength: 7, spellCheck: false, autoComplete: 'off' } }}
      />
    </Stack>
  )
}

// La advertencia de contraste NO bloquea el guardado (FR-023): con AA se informa; sin AA se advierte.
export function AvisoContraste({ colorPrimario }: { colorPrimario: string }) {
  const evaluacion = evaluarContraste(colorPrimario)
  if (!evaluacion) return null
  return (
    <Alert severity={evaluacion.cumpleAA ? 'info' : 'warning'} role={evaluacion.cumpleAA ? 'status' : 'alert'}>
      {evaluacion.texto}
    </Alert>
  )
}

// Carga las fuentes elegidas (solo familias de la lista cerrada) para que la muestra se vea como será.
export function useFuentes(tipografias: { tipografiaTitulos: Tipografia; tipografiaTexto: Tipografia }) {
  const { tipografiaTitulos, tipografiaTexto } = tipografias
  useEffect(() => {
    const url = urlFuentes(familiasACargar({ tipografiaTitulos, tipografiaTexto }))
    if (!url) return
    const existente = Array.from(document.head.querySelectorAll('link[data-tienda-fuentes]')).find((enlace) => enlace.getAttribute('href') === url)
    if (existente) return
    const enlace = document.createElement('link')
    enlace.rel = 'stylesheet'
    enlace.href = url
    enlace.setAttribute('data-tienda-fuentes', '')
    document.head.appendChild(enlace)
  }, [tipografiaTitulos, tipografiaTexto])
}

const pila = (tipografia: Tipografia) => `"${tipografia}", system-ui, sans-serif`

export function SelectorTipografia({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string
  valor: Tipografia
  onChange: (valor: Tipografia) => void
}) {
  return (
    <TextField select label={etiqueta} value={valor} onChange={(evento) => onChange(evento.target.value as Tipografia)} size="small" fullWidth>
      {TIPOGRAFIAS.map((tipografia) => (
        <MenuItem key={tipografia} value={tipografia} sx={{ fontFamily: pila(tipografia) }}>
          {tipografia === 'system-ui' ? 'Del sistema' : tipografia}
        </MenuItem>
      ))}
    </TextField>
  )
}

export function MuestraTipografia({ titulos, texto }: { titulos: Tipografia; texto: Tipografia }) {
  return (
    <Box sx={{ mt: 1.5, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: (tema) => tema.shape.borderRadius, bgcolor: 'background.paper' }}>
      <Typography component="p" sx={{ fontFamily: pila(titulos), fontSize: tokens.tipografia.escala.t1.tamano, fontWeight: 700 }}>Todo para tu consola</Typography>
      <Typography component="p" sx={{ fontFamily: pila(texto), fontSize: tokens.tipografia.escala.b.tamano, mt: 0.75 }}>
        Cargadores, joysticks, cases y protectores para Nintendo Switch.
      </Typography>
    </Box>
  )
}
