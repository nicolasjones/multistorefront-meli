import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  FORMULARIO_ESTADO_VACIO,
  MENSAJE_ESTADO_REPETIDO,
  crearEstado,
  esEstadoRepetido,
  mensajeDeErrorService,
  validarEstado,
  type ErroresEstado,
  type FormularioEstado,
} from '../../lib/serviceTecnico'

type Props = { abierto: boolean; onCerrar: () => void; onCreado: () => void }

// Diálogo «Nuevo estado» del prototipo (FR-008): Nombre, Qué significa y «Avisar al cliente al pasar a este
// estado». El indicador solo se guarda: esta épica no envía avisos (FR-006).
export function EstadoFormDialog({ abierto, onCerrar, onCreado }: Props) {
  const [formulario, setFormulario] = useState<FormularioEstado>(FORMULARIO_ESTADO_VACIO)
  const [errores, setErrores] = useState<ErroresEstado>({})
  const [guardando, setGuardando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  const cerrar = () => {
    if (guardando) return
    setFormulario(FORMULARIO_ESTADO_VACIO)
    setErrores({})
    setErrorGeneral(null)
    onCerrar()
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando) return
    const encontrados = validarEstado(formulario)
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) return
    setGuardando(true)
    try {
      await crearEstado(formulario)
      setFormulario(FORMULARIO_ESTADO_VACIO)
      setErrores({})
      onCreado()
    } catch (error) {
      if (esEstadoRepetido(error)) {
        console.error('Estado repetido.', error)
        setErrores({ nombre: MENSAJE_ESTADO_REPETIDO })
      } else {
        setErrorGeneral(mensajeDeErrorService(error, 'No pudimos crear el estado. Intentá de nuevo.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-nuevo-estado">
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-nuevo-estado" onCerrar={cerrar}>Nuevo estado</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <TextField
              label="Nombre"
              value={formulario.nombre}
              onChange={(evento) => {
                setFormulario((previo) => ({ ...previo, nombre: evento.target.value }))
                setErrores((previos) => ({ ...previos, nombre: undefined }))
              }}
              placeholder="Presupuesto aprobado"
              required
              autoFocus
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
            />
            <TextField
              label="Qué significa"
              value={formulario.descripcion}
              onChange={(evento) => {
                setFormulario((previo) => ({ ...previo, descripcion: evento.target.value }))
                setErrores((previos) => ({ ...previos, descripcion: undefined }))
              }}
              placeholder="El cliente aceptó el presupuesto"
              multiline
              minRows={2}
              error={Boolean(errores.descripcion)}
              helperText={errores.descripcion}
            />
            <FormControlLabel
              label="Avisar al cliente al pasar a este estado"
              control={
                <Checkbox
                  checked={formulario.avisa_cliente}
                  onChange={(evento) => setFormulario((previo) => ({ ...previo, avisa_cliente: evento.target.checked }))}
                />
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Creando…' : 'Crear estado'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
