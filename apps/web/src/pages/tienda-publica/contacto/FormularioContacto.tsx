import { Alert, Box, Button, FormHelperText, InputBase, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { registrarEventoTienda } from '../../../lib/analiticaTienda'
import { enviarConsultaContacto, minutosDeEspera, nuevaClaveEnvio } from '../../../lib/tiendaContacto'
import { ErrorConReintento } from '../ErrorConReintento'
import { IconoTilde } from '../layout/iconos'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import { useCelular } from '../useAnchoCelular'
import { MENSAJE_CAMPO_SERVIDOR, ORDEN_CAMPOS, validarContacto, type CampoContacto, type DatosContacto, type ErroresContacto } from './validacion'
import { LINEA_SUAVE } from '../layout/medidas'

type Fase =
  | { fase: 'editando' }
  | { fase: 'enviando' }
  | { fase: 'exito' }
  | { fase: 'espera'; esperaSegundos: number }
  | { fase: 'falla' }

const VACIO: DatosContacto = { nombre: '', contacto: '', mensaje: '' }

// Tarjeta del formulario (prototipo): fondo blanco, borde de 1 px, radio 12 y 32 px de relleno; en celular el formulario va
// sin tarjeta (`MJC_M_Contacto`).
const estiloTarjeta = { bgcolor: 'background.paper', border: { xs: 0, md: LINEA_SUAVE }, borderRadius: '12px', p: { xs: 0, md: '32px' }, minWidth: 0 } as const // estilos-sueltos: ok

// Campo del prototipo (`.fin`): el rótulo (14 px/600) ARRIBA del campo —no flotante—, campo de 44 px (el mensaje, de 110 px como
// mínimo) con borde de 1,5 px, radio 8 y texto de apoyo en el gris secundario (contraste AA) y el foco visible (borde y contorno primarios). El rótulo es un <label> asociado; el error va debajo con
// `aria-describedby`.
function Campo({ id, etiqueta, ejemplo, valor, alCambiar, error, autoComplete, multilinea = false, inputRef, rotuloVisible = true }: {
  id: string
  etiqueta: string
  ejemplo: string
  valor: string
  alCambiar: (evento: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  error?: string
  autoComplete?: string
  multilinea?: boolean
  inputRef: (el: HTMLInputElement | null) => void
  // Bajo `md` (celular y tableta chica) el prototipo (`MJC_M_Contacto`) solo muestra el texto de apoyo: el rótulo queda para lectores de
  // pantalla y el texto de apoyo del segundo campo es «Correo o WhatsApp» (WCAG 1.3.1/3.3.2: el rótulo sigue asociado y a la vista).
  rotuloVisible?: boolean
}) {
  const idError = `${id}-error`
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography component="label" htmlFor={id} sx={rotuloVisible ? { display: 'block', fontSize: 14, fontWeight: 600, mb: '6px' /* estilos-sueltos: ok */ } : SOLO_LECTORES}>{etiqueta}</Typography>
      <InputBase
        id={id}
        fullWidth
        multiline={multilinea}
        minRows={multilinea ? 4 : undefined}
        placeholder={ejemplo}
        value={valor}
        onChange={alCambiar}
        error={Boolean(error)}
        inputRef={inputRef}
        inputProps={{ 'aria-required': true, 'aria-invalid': Boolean(error), 'aria-describedby': error ? idError : undefined, autoComplete }}
        sx={{
          alignItems: multilinea ? 'flex-start' : 'center', height: multilinea ? 'auto' : 44, minHeight: multilinea ? 110 : undefined, px: '12px', py: multilinea ? '10px' : 0, // estilos-sueltos: ok
          fontSize: 15, bgcolor: 'background.paper', border: '1.5px solid', borderColor: error ? 'error.main' : 'rgba(0,0,0,.18)', borderRadius: '8px', // estilos-sueltos: ok
          '&.Mui-focused': { borderColor: 'primary.main', outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'primary.main', outlineOffset: '1px' }, // estilos-sueltos: ok
          '& input::placeholder, & textarea::placeholder': { color: 'text.secondary', opacity: 1 },
        }}
      />
      {error ? <FormHelperText id={idError} error>{error}</FormHelperText> : null}
    </Box>
  )
}

// Formulario «Escribinos» (F-TDA-16, FR-011…FR-013, FR-015). Valida en el cliente (espejo del servidor), envía
// con una `clave_envio` por intento y conserva lo escrito ante límite o error. Foco al primer error y al
// mensaje de éxito; los errores se asocian a su campo con aria-describedby (MUI lo hace con el helperText).
export function FormularioContacto({ host }: { host: string }) {
  const movil = useCelular()
  const [datos, setDatos] = useState<DatosContacto>(VACIO)
  const [errores, setErrores] = useState<ErroresContacto>({})
  const [estado, setEstado] = useState<Fase>({ fase: 'editando' })
  const clave = useRef(nuevaClaveEnvio())
  const campos = useRef<Partial<Record<CampoContacto, HTMLInputElement | null>>>({})
  const gracias = useRef<HTMLHeadingElement | null>(null)
  const enviandoAhora = useRef(false)
  const debeFocalizarNombre = useRef(false)

  useEffect(() => {
    if (estado.fase === 'exito') gracias.current?.focus()
    if (estado.fase === 'editando' && debeFocalizarNombre.current) {
      debeFocalizarNombre.current = false
      campos.current.nombre?.focus()
    }
  }, [estado])

  const cambiar = (campo: CampoContacto) => (evento: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDatos((actuales) => ({ ...actuales, [campo]: evento.target.value }))
    setErrores((actuales) => ({ ...actuales, [campo]: undefined }))
    // Un texto distinto es otra consulta: no puede reutilizar la clave de un intento anterior.
    if (estado.fase === 'falla' || estado.fase === 'espera') {
      clave.current = nuevaClaveEnvio()
      setEstado({ fase: 'editando' })
    }
  }

  const enviar = async (evento?: FormEvent) => {
    evento?.preventDefault()
    if (enviandoAhora.current) return
    const erroresNuevos = validarContacto(datos)
    setErrores(erroresNuevos)
    const primero = ORDEN_CAMPOS.find((campo) => erroresNuevos[campo])
    if (primero) {
      campos.current[primero]?.focus()
      return
    }
    enviandoAhora.current = true
    setEstado({ fase: 'enviando' })
    const resultado = await enviarConsultaContacto(host, datos, clave.current)
    enviandoAhora.current = false
    switch (resultado.estado) {
      case 'exito':
        // Evento de medición (F-TDA-24, FR-016): solo en el envío confirmado, sin datos del mensaje ni del visitante.
        registrarEventoTienda('envio_contacto')
        setEstado({ fase: 'exito' })
        return
      case 'invalido': {
        const delServidor: ErroresContacto = {}
        for (const campo of resultado.campos) delServidor[campo] = MENSAJE_CAMPO_SERVIDOR[campo]
        setErrores(delServidor)
        setEstado({ fase: 'editando' })
        const primeroServidor = ORDEN_CAMPOS.find((campo) => delServidor[campo])
        if (primeroServidor) campos.current[primeroServidor]?.focus()
        return
      }
      case 'espera':
        setEstado({ fase: 'espera', esperaSegundos: resultado.esperaSegundos })
        return
      default:
        setEstado({ fase: 'falla' })
    }
  }

  const enviarOtra = () => {
    setDatos(VACIO)
    setErrores({})
    clave.current = nuevaClaveEnvio()
    debeFocalizarNombre.current = true
    setEstado({ fase: 'editando' })
  }

  if (estado.fase === 'exito') {
    return (
      <Box component="section" aria-labelledby="contacto-gracias" data-testid="contacto-exito" sx={estiloTarjeta}>
        {/* Prototipo: el título «Escribinos» se conserva sobre el recuadro de éxito. */}
        <Typography component="p" variant="h6" aria-hidden sx={{ fontSize: { xs: 22, md: 24 }, mb: '16px' /* estilos-sueltos: ok */ }}>Escribinos</Typography>
        <Box sx={{ py: '40px', px: '24px', textAlign: 'center', border: '1.5px solid rgba(0,0,0,.1)', borderRadius: '12px' /* estilos-sueltos: ok */ }}>
          <Box component="span" aria-hidden sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: '#E1F3E7', color: '#146B35', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' /* estilos-sueltos: ok */ }}>
            <IconoTilde size={28} />
          </Box>
          <Typography id="contacto-gracias" component="h2" variant="h6" tabIndex={-1} ref={gracias} sx={{ fontSize: 24, mt: '14px', outline: 'none' /* estilos-sueltos: ok */ }}>
            ¡Gracias! Recibimos tu consulta
          </Typography>
          <Typography color="text.secondary" sx={{ mt: '6px' }}>Te respondemos por el medio que dejaste.</Typography>
          <Button variant="outlined" onClick={enviarOtra} sx={{ mt: 2, px: '18px', py: '10px', fontSize: 16, border: '2px solid', borderColor: 'primary.main', '&:hover': { border: '2px solid', borderColor: 'primary.main' } /* estilos-sueltos: ok */ }}>Enviar otra</Button>
        </Box>
      </Box>
    )
  }

  const enviando = estado.fase === 'enviando'
  return (
    <Box component="section" aria-labelledby="contacto-escribinos" sx={estiloTarjeta}>
      <Typography id="contacto-escribinos" component="h2" variant="h6" sx={{ fontSize: { xs: 22, md: 24 }, mb: '16px' /* estilos-sueltos: ok */ }}>Escribinos</Typography>
      <Box component="form" noValidate onSubmit={(evento) => void enviar(evento)}>
        <Stack spacing="14px">
          {estado.fase === 'espera' ? (
            <Alert severity="warning" data-testid="contacto-espera">
              Hiciste varias consultas seguidas. Probá de nuevo en {minutosDeEspera(estado.esperaSegundos)} {minutosDeEspera(estado.esperaSegundos) === 1 ? 'minuto' : 'minutos'}.
            </Alert>
          ) : null}
          {estado.fase === 'falla' ? (
            <ErrorConReintento
              titulo="No pudimos enviar tu consulta."
              descripcion="Revisá tu conexión y probá de nuevo. No perdiste lo que escribiste."
              alReintentar={() => void enviar()}
            />
          ) : null}
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: '14px' }}>
            <Campo
              id="contacto-nombre"
              rotuloVisible={!movil}
              etiqueta="Nombre"
              ejemplo="Tu nombre"
              valor={datos.nombre}
              alCambiar={cambiar('nombre')}
              error={errores.nombre}
              autoComplete="name"
              inputRef={(el) => { campos.current.nombre = el }}
            />
            <Campo
              id="contacto-contacto"
              rotuloVisible={!movil}
              etiqueta="Correo o WhatsApp"
              ejemplo={movil ? 'Correo o WhatsApp' : 'Para responderte'}
              valor={datos.contacto}
              alCambiar={cambiar('contacto')}
              error={errores.contacto}
              inputRef={(el) => { campos.current.contacto = el }}
            />
          </Box>
          <Campo
            id="contacto-mensaje"
            rotuloVisible={!movil}
            etiqueta="Mensaje"
            ejemplo="Contanos qué producto te interesa"
            valor={datos.mensaje}
            alCambiar={cambiar('mensaje')}
            error={errores.mensaje}
            multilinea
            inputRef={(el) => { campos.current.mensaje = el }}
          />
          <Button type="submit" variant="contained" disabled={enviando} sx={{ height: 48, fontSize: 16, width: '100%' /* estilos-sueltos: ok */ }}>
            {enviando ? 'Enviando…' : 'Enviar consulta'}
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
