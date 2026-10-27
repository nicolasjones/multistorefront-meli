import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { enviarConsultaContacto, minutosDeEspera, nuevaClaveEnvio } from '../../../lib/tiendaContacto'
import { ErrorConReintento } from '../ErrorConReintento'
import { MENSAJE_CAMPO_SERVIDOR, ORDEN_CAMPOS, validarContacto, type CampoContacto, type DatosContacto, type ErroresContacto } from './validacion'

type Fase =
  | { fase: 'editando' }
  | { fase: 'enviando' }
  | { fase: 'exito' }
  | { fase: 'espera'; esperaSegundos: number }
  | { fase: 'falla' }

const VACIO: DatosContacto = { nombre: '', contacto: '', mensaje: '' }

// Formulario «Escribinos» (F-TDA-16, FR-011…FR-013, FR-015). Valida en el cliente (espejo del servidor), envía
// con una `clave_envio` por intento y conserva lo escrito ante límite o error. Foco al primer error y al
// mensaje de éxito; los errores se asocian a su campo con aria-describedby (MUI lo hace con el helperText).
export function FormularioContacto({ host }: { host: string }) {
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
      <Box component="section" aria-labelledby="contacto-gracias" data-testid="contacto-exito" sx={{ py: 2 }}>
        <Typography id="contacto-gracias" component="h2" variant="h6" tabIndex={-1} ref={gracias} sx={{ fontWeight: 700, outline: 'none' }}>
          ¡Gracias! Recibimos tu consulta
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Te respondemos por el medio que dejaste.</Typography>
        <Button variant="outlined" onClick={enviarOtra} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Enviar otra</Button>
      </Box>
    )
  }

  const enviando = estado.fase === 'enviando'
  return (
    <Box component="section" aria-labelledby="contacto-escribinos">
      <Typography id="contacto-escribinos" component="h2" variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Escribinos</Typography>
      <Box component="form" noValidate onSubmit={(evento) => void enviar(evento)}>
        <Stack spacing={2}>
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
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <TextField
              label="Nombre"
              placeholder="Tu nombre"
              value={datos.nombre}
              onChange={cambiar('nombre')}
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
              required
              fullWidth
              autoComplete="name"
              inputRef={(el: HTMLInputElement | null) => { campos.current.nombre = el }}
            />
            <TextField
              label="Correo o WhatsApp"
              placeholder="Para responderte"
              value={datos.contacto}
              onChange={cambiar('contacto')}
              error={Boolean(errores.contacto)}
              helperText={errores.contacto}
              required
              fullWidth
              inputRef={(el: HTMLInputElement | null) => { campos.current.contacto = el }}
            />
          </Box>
          <TextField
            label="Mensaje"
            placeholder="Contanos qué producto te interesa"
            value={datos.mensaje}
            onChange={cambiar('mensaje')}
            error={Boolean(errores.mensaje)}
            helperText={errores.mensaje}
            required
            fullWidth
            multiline
            minRows={4}
            inputRef={(el: HTMLInputElement | null) => { campos.current.mensaje = el }}
          />
          <Box>
            <Button type="submit" variant="contained" disabled={enviando} sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}>
              {enviando ? 'Enviando…' : 'Enviar consulta'}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
