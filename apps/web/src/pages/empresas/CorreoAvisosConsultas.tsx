import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { useCorreoAvisosConsultas } from '../../hooks/useCorreoAvisosConsultas'

type Props = {
  empresaId: string
  correoContacto: string | null
  soloLectura: boolean
}

// Campo «Correo para avisos de consultas» de la pestaña General (F-CON-03, FR-010). La épica lo
// pide aunque el prototipo de StoreGeneral no lo dibuje (divergencia anotada en el PR). Se guarda
// aparte del formulario general porque la RPC tiene su propio bloqueo optimista y su permiso
// (`empresas` = edición), y así un conflicto del aviso no pierde los demás cambios sin guardar.
export function CorreoAvisosConsultas({ empresaId, correoContacto, soloLectura }: Props) {
  const { correoAvisos, isLoading, isError, refetch, guardar } = useCorreoAvisosConsultas(empresaId)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const sincronizado = useRef(false)

  // Una sola sincronización por empresa: lo que la persona escribió no se pisa con una recarga
  // posterior (por ejemplo, la que sigue a un conflicto).
  useEffect(() => {
    if (sincronizado.current || isLoading || isError) return
    setTexto(correoAvisos ?? correoContacto ?? '')
    sincronizado.current = true
  }, [correoAvisos, correoContacto, isLoading, isError])

  const cambiar = (event: ChangeEvent<HTMLInputElement>) => {
    setTexto(event.target.value)
    setExito(false)
    setError(null)
  }

  const guardarDireccion = async () => {
    if (guardando) return
    setExito(false)
    setError(null)
    setGuardando(true)
    const resultado = await guardar(texto, correoContacto)
    setGuardando(false)
    if (resultado.ok) {
      // Sin dirección propia el campo vuelve a mostrar el correo de contacto efectivo.
      setTexto(resultado.correoAvisos ?? correoContacto ?? '')
      setExito(true)
    } else {
      setError(resultado.mensaje)
    }
  }

  const deshabilitado = soloLectura || isLoading || isError

  return (
    <Box component="section" aria-labelledby="avisos-consultas-titulo">
      <Typography id="avisos-consultas-titulo" component="h2" variant="subtitle1" sx={{ mb: 0.5 }}>
        Avisos de consultas
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Los avisos de consulta nueva se envían a cada persona según sus preferencias en
        «Avisos por correo». Esta dirección ya no se usa para las consultas nuevas: solo completa el envío
        de los avisos que ya estaban encolados por el camino anterior.
      </Typography>
      <Stack spacing={1.5}>
        {isError ? (
          <EstadoError
            titulo="No pudimos cargar la dirección de avisos."
            descripcion="Volvé a intentar para ver la dirección vigente."
            reintentar={() => void refetch()}
          />
        ) : null}
        {exito ? <EstadoExito titulo="Dirección de avisos guardada." /> : null}
        {error ? <EstadoError titulo="No se guardó la dirección de avisos." descripcion={error} /> : null}
        <TextField
          label="Correo para avisos de consultas"
          type="email"
          value={texto}
          onChange={cambiar}
          disabled={deshabilitado}
          helperText={soloLectura ? 'Solo los administradores pueden editarla.' : 'Dirección del camino anterior; el aviso nuevo ya no la usa.'}
          fullWidth
        />
        {soloLectura ? null : (
          <Box>
            <Button type="button" variant="outlined" onClick={() => void guardarDireccion()} disabled={guardando || deshabilitado}>
              {guardando ? 'Guardando…' : 'Guardar dirección de avisos'}
            </Button>
          </Box>
        )}
      </Stack>
    </Box>
  )
}
