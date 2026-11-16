import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { esSinAcceso } from '../../../lib/tiendaCuentaDatos'
import { guardarOpinion, type ResultadoGuardar } from '../../../lib/tiendaOpiniones'
import { EstrellasPuntuacion } from './EstrellasPuntuacion'
import { COMENTARIO_MAXIMO, COMENTARIO_MINIMO, largoComentario, validarOpinion, type CampoOpinion } from './validacion'

export const TEXTO_GRACIAS = 'Gracias, tu opinión se publicará cuando la revisemos'
export const TEXTO_ERROR_PUNTUACION = 'Elegí de 1 a 5 estrellas'
export const TEXTO_ERROR_COMENTARIO = `Escribí entre ${COMENTARIO_MINIMO} y ${COMENTARIO_MAXIMO} caracteres, sin enlaces ni saltos de línea`
const TEXTO_ERROR = 'No pudimos guardar tu opinión. Probá de nuevo.'
const TEXTO_LIMITE_OPINIONES = 'Llegaste al máximo de opiniones. Borrá alguna desde «Mi cuenta» para opinar de nuevo.'
const TEXTO_LIMITE_PENDIENTES = 'Tenés varias opiniones esperando revisión. Probá de nuevo cuando las revisemos.'
const TEXTO_NO_ENCONTRADO = 'Este producto ya no está disponible para opinar.'
const TEXTO_LIMITE = 'Hiciste muchos intentos seguidos. Probá de nuevo en un minuto.'

type Guardada = Extract<ResultadoGuardar, { estado: 'ok' }>['opinion']

// Formulario «Tu opinión» (MSF-467, RF-OPI-11): estrellas con teclado, comentario con contador y errores por campo. La validación
// del cliente es un espejo para avisar antes de enviar; el servidor manda. La opinión nueva o editada queda pendiente.
export function FormularioOpinion({ host, productoId, inicial = null, textoEnviar = 'Enviar opinión', alGuardar, alCancelar, alSinAcceso }: {
  host: string
  productoId: string
  inicial?: { puntuacion: number; comentario: string } | null
  textoEnviar?: string
  alGuardar: (opinion: Guardada) => void
  alCancelar?: () => void
  alSinAcceso: () => void
}) {
  const id = useId()
  const [puntuacion, setPuntuacion] = useState<number | null>(inicial?.puntuacion ?? null)
  const [comentario, setComentario] = useState(inicial?.comentario ?? '')
  const [errores, setErrores] = useState<ReadonlySet<CampoOpinion>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault()
    if (enviando) return
    const validacion = validarOpinion(puntuacion, comentario)
    setAviso(null)
    setErrores(new Set(validacion.campos))
    if (!validacion.ok || puntuacion === null) return
    setEnviando(true)
    try {
      const resultado = await guardarOpinion(host, productoId, puntuacion, validacion.comentario)
      switch (resultado.estado) {
        case 'ok': alGuardar(resultado.opinion); break
        case 'invalido': setErrores(new Set(resultado.campos)); break
        case 'limite_opiniones': setAviso(TEXTO_LIMITE_OPINIONES); break
        case 'limite_pendientes': setAviso(TEXTO_LIMITE_PENDIENTES); break
        case 'no_encontrado': setAviso(TEXTO_NO_ENCONTRADO); break
        case 'limite': setAviso(TEXTO_LIMITE); break
      }
    } catch (error) {
      if (esSinAcceso(error)) alSinAcceso()
      else setAviso(TEXTO_ERROR)
    } finally {
      setEnviando(false)
    }
  }

  const largo = largoComentario(comentario)
  const idErrorPuntuacion = `${id}-error-puntuacion`
  return (
    <Box component="form" noValidate onSubmit={(evento: React.FormEvent) => { void enviar(evento) }} aria-label="Tu opinión" sx={{ display: 'grid', gap: 1.5 }}>
      <Box>
        <Typography id={`${id}-etiqueta`} component="p" sx={{ fontWeight: 600 }}>Tu puntuación</Typography>
        <EstrellasPuntuacion
          valor={puntuacion}
          alCambiar={(nuevo) => { setPuntuacion(nuevo); setErrores((previos) => { const resto = new Set(previos); resto.delete('puntuacion'); return resto }) }}
          deshabilitado={enviando}
          idDescripcion={errores.has('puntuacion') ? idErrorPuntuacion : undefined}
        />
        {errores.has('puntuacion') ? <Typography id={idErrorPuntuacion} role="alert" color="error" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{TEXTO_ERROR_PUNTUACION}</Typography> : null}
      </Box>
      <TextField
        label="Tu comentario"
        multiline
        minRows={3}
        value={comentario}
        onChange={(evento) => setComentario(evento.target.value)}
        disabled={enviando}
        error={errores.has('comentario')}
        helperText={errores.has('comentario') ? TEXTO_ERROR_COMENTARIO : `${largo} de ${COMENTARIO_MAXIMO} caracteres (mínimo ${COMENTARIO_MINIMO})`}
        slotProps={{ htmlInput: { 'aria-required': true } }}
        fullWidth
      />
      {aviso ? <Alert severity="error" role="alert">{aviso}</Alert> : null}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button type="submit" variant="contained" disabled={enviando} sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}>{enviando ? 'Enviando…' : textoEnviar}</Button>
        {alCancelar ? <Button type="button" variant="outlined" disabled={enviando} onClick={alCancelar} sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}>Cancelar</Button> : null}
      </Box>
    </Box>
  )
}
