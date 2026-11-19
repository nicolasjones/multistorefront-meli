import { Box, Button, Checkbox, FormControlLabel, FormHelperText, InputBase, Typography } from '@mui/material'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNewsletterTienda } from '../../../hooks/useNewsletterTienda'
import {
  MAX_CORREO,
  MENSAJE_CAMPO_SERVIDOR_NEWSLETTER,
  ORDEN_CAMPOS_NEWSLETTER,
  nuevaClaveNewsletter,
  suscribirseNewsletter,
  validarSuscripcion,
  type ErroresNewsletter,
} from '../../../lib/tiendaNewsletter'
import { useLegalTienda } from '../../../lib/tiendaLegal'
import { urlHttpSegura } from '../../../lib/urlHttpSegura'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import { estiloTituloPie } from '../layout/estilosPie'
import { COLOR_FOCO } from '../layout/medidas'

type Fase =
  | { fase: 'editando' }
  | { fase: 'enviando' }
  | { fase: 'exito' }
  | { fase: 'espera'; esperaSegundos: number }
  | { fase: 'falla' }

// Los mensajes de error van con el color del pie (texto sobre el fondo de la tienda, que ya cumple el contraste AA). FormHelperText pinta
// `.Mui-error` con `error.main` (rojo) y esa regla le gana a un `color: inherit` suelto; el rojo sobre el pie oscuro no llega a 4,5:1
// (axe `color-contrast`, MSF-961). El error se distingue por el borde, `aria-invalid` y el texto, no solo por el color.
const ESTILO_ERROR_PIE = { color: 'inherit', fontWeight: 600, '&.Mui-error': { color: 'inherit' } } as const

const minutos = (segundos: number) => Math.max(1, Math.ceil(segundos / 60))

// Formulario de suscripción del pie de la tienda (MSF-468, RF-NL-2, CA-NL-1). Se muestra SOLO si la base dice `activo` (bandera
// `newsletter`, interruptor de la tienda y tienda activa): mientras carga, apagado o con error no se renderiza nada. Correo y casilla de
// consentimiento obligatoria y sin marcar; campo trampa oculto (no se completa a mano); una clave por intento (el reintento la
// reutiliza). La respuesta de éxito es la misma exista o no la dirección: «Te enviamos un correo para confirmar tu suscripción».
export function FormularioSuscripcion({ host }: { host: string }) {
  const { activo, tienda } = useNewsletterTienda(host)
  const legal = useLegalTienda(host)
  const [correo, setCorreo] = useState('')
  const [consentimiento, setConsentimiento] = useState(false)
  const [trampa, setTrampa] = useState('')
  const [errores, setErrores] = useState<ErroresNewsletter>({})
  const [estado, setEstado] = useState<Fase>({ fase: 'editando' })
  const clave = useRef(nuevaClaveNewsletter())
  const enviandoAhora = useRef(false)
  const campoCorreo = useRef<HTMLInputElement | null>(null)
  const campoCasilla = useRef<HTMLInputElement | null>(null)

  if (!activo || !tienda) return null

  const politica = legal?.enlaces.find((enlace) => /privacidad/i.test(enlace.titulo)) ?? null
  // Solo http: o https: llegan al href.
  const urlPolitica = urlHttpSegura(politica?.url)

  const enviar = async (evento?: FormEvent) => {
    evento?.preventDefault()
    if (enviandoAhora.current) return
    const erroresNuevos = validarSuscripcion({ correo, consentimiento })
    setErrores(erroresNuevos)
    if (erroresNuevos.correo) { campoCorreo.current?.focus(); return }
    if (erroresNuevos.consentimiento) { campoCasilla.current?.focus(); return }
    enviandoAhora.current = true
    setEstado({ fase: 'enviando' })
    const resultado = await suscribirseNewsletter(host, { correo, consentimiento }, clave.current, trampa)
    enviandoAhora.current = false
    switch (resultado.estado) {
      case 'exito':
        setEstado({ fase: 'exito' })
        return
      case 'invalido': {
        const delServidor: ErroresNewsletter = {}
        for (const campo of resultado.campos) delServidor[campo] = MENSAJE_CAMPO_SERVIDOR_NEWSLETTER[campo]
        setErrores(delServidor)
        setEstado({ fase: 'editando' })
        const primero = ORDEN_CAMPOS_NEWSLETTER.find((campo) => delServidor[campo])
        if (primero === 'correo') campoCorreo.current?.focus()
        if (primero === 'consentimiento') campoCasilla.current?.focus()
        return
      }
      case 'espera':
        setEstado({ fase: 'espera', esperaSegundos: resultado.esperaSegundos })
        return
      default:
        setEstado({ fase: 'falla' })
    }
  }

  const cambiarCorreo = (evento: ChangeEvent<HTMLInputElement>) => {
    setCorreo(evento.target.value)
    setErrores((actuales) => ({ ...actuales, correo: undefined }))
    // Otro correo es otro pedido: no puede reutilizar la clave de un intento anterior.
    clave.current = nuevaClaveNewsletter()
    if (estado.fase === 'falla' || estado.fase === 'espera') setEstado({ fase: 'editando' })
  }

  const enviando = estado.fase === 'enviando'
  return (
    <Box component="section" id="newsletter-suscripcion" aria-labelledby="newsletter-titulo" data-testid="pie-newsletter" sx={{ maxWidth: 340, minWidth: 0 }}>
      <Typography id="newsletter-titulo" component="h2" sx={estiloTituloPie}>Newsletter</Typography>
      {estado.fase === 'exito' ? (
        <Typography role="status" data-testid="newsletter-exito" sx={{ fontSize: 14, mt: 1 /* estilos-sueltos: ok */ }}>
          Te enviamos un correo para confirmar tu suscripción.
        </Typography>
      ) : (
        <Box component="form" noValidate onSubmit={(evento) => void enviar(evento)} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 14, mb: 1 /* estilos-sueltos: ok */ }}>Recibí las novedades de {tienda} por correo.</Typography>
          {/* Campo trampa (honeypot): fuera de pantalla y del orden de tabulación; una persona no lo completa. */}
          <Box aria-hidden sx={SOLO_LECTORES}>
            <label>
              No completar este campo
              <input name="sitio" tabIndex={-1} autoComplete="off" value={trampa} onChange={(evento) => setTrampa(evento.target.value)} />
            </label>
          </Box>
          <Typography component="label" htmlFor="newsletter-correo" sx={SOLO_LECTORES}>Correo electrónico</Typography>
          <InputBase
            id="newsletter-correo"
            fullWidth
            type="email"
            placeholder="Tu correo"
            value={correo}
            onChange={cambiarCorreo}
            error={Boolean(errores.correo)}
            inputRef={campoCorreo}
            inputProps={{
              'aria-required': true,
              'aria-invalid': Boolean(errores.correo),
              'aria-describedby': errores.correo ? 'newsletter-correo-error' : undefined,
              autoComplete: 'email',
              maxLength: MAX_CORREO + 20,
            }}
            sx={{
              height: 44, px: '12px', fontSize: 15, bgcolor: 'background.paper', color: 'text.primary', border: '1.5px solid', borderColor: errores.correo ? 'error.main' : 'rgba(0,0,0,.18)', borderRadius: '8px', // estilos-sueltos: ok
              '&.Mui-focused': { borderColor: 'primary.main', outlineStyle: 'solid', outlineWidth: '2px', outlineColor: COLOR_FOCO, outlineOffset: '1px' }, // estilos-sueltos: ok
              '& input::placeholder': { color: 'text.secondary', opacity: 1 },
            }}
          />
          {errores.correo ? <FormHelperText id="newsletter-correo-error" error sx={ESTILO_ERROR_PIE}>{errores.correo}</FormHelperText> : null}
          <FormControlLabel
            sx={{ alignItems: 'flex-start', mx: 0, mt: 1, '& .MuiFormControlLabel-label': { fontSize: 13 } /* estilos-sueltos: ok */ }}
            control={
              <Checkbox
                size="small"
                checked={consentimiento}
                onChange={(evento) => { setConsentimiento(evento.target.checked); setErrores((actuales) => ({ ...actuales, consentimiento: undefined })) }}
                inputRef={campoCasilla}
                inputProps={{ 'aria-required': true, 'aria-invalid': Boolean(errores.consentimiento), 'aria-describedby': errores.consentimiento ? 'newsletter-consentimiento-error' : undefined }}
                sx={{ color: 'inherit', '&.Mui-checked': { color: 'inherit' }, py: 0.25, pl: 0 }}
              />
            }
            label={<>Acepto recibir novedades de {tienda} por correo.{urlPolitica ? <> <Box component="a" href={urlPolitica} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit' }}>Política de privacidad</Box></> : null}</>}
          />
          {errores.consentimiento ? <FormHelperText id="newsletter-consentimiento-error" error sx={ESTILO_ERROR_PIE}>{errores.consentimiento}</FormHelperText> : null}
          {estado.fase === 'espera' ? (
            <Typography role="alert" data-testid="newsletter-espera" sx={{ fontSize: 13, mt: 1 /* estilos-sueltos: ok */ }}>
              Probá de nuevo en {minutos(estado.esperaSegundos)} {minutos(estado.esperaSegundos) === 1 ? 'minuto' : 'minutos'}.
            </Typography>
          ) : null}
          {estado.fase === 'falla' ? (
            <Typography role="alert" data-testid="newsletter-falla" sx={{ fontSize: 13, mt: 1 /* estilos-sueltos: ok */ }}>
              No pudimos registrar tu suscripción. Revisá tu conexión y probá de nuevo.
            </Typography>
          ) : null}
          <Button
            type="submit"
            variant="contained"
            disabled={enviando}
            sx={{ mt: 1.5, height: 44, fontSize: 15, width: '100%' /* estilos-sueltos: ok */ }}
          >
            {enviando ? 'Enviando…' : estado.fase === 'falla' ? 'Reintentar' : 'Suscribirme'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
