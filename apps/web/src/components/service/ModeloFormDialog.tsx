import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  FORMULARIO_MODELO_VACIO,
  actualizarModelo,
  crearModelo,
  esModeloRepetido,
  mensajeDeErrorService,
  validarModelo,
  type ErroresModelo,
  type FormularioModelo,
  type ModeloEquipo,
  MENSAJE_MODELO_REPETIDO,
} from '../../lib/serviceTecnico'

type Props = { abierto: boolean; modelo?: ModeloEquipo | null; onCerrar: () => void; onGuardado: () => void }

// Diálogo «Nuevo modelo» del prototipo (FR-007): Equipo, Modelo y Mano de obra base en ARS (sin IVA). Con `modelo`
// es la edición del mismo formulario, con bloqueo optimista por updated_at.
export function ModeloFormDialog({ abierto, modelo = null, onCerrar, onGuardado }: Props) {
  const [formulario, setFormulario] = useState<FormularioModelo>(FORMULARIO_MODELO_VACIO)
  const [errores, setErrores] = useState<ErroresModelo>({})
  const [guardando, setGuardando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  const formularioInicial = (): FormularioModelo =>
    modelo
      ? { equipo: modelo.equipo, modelo: modelo.modelo, mano_obra_base: String(modelo.mano_obra_base).replace('.', ',') }
      : FORMULARIO_MODELO_VACIO

  useEffect(() => {
    if (!abierto) return
    setFormulario(formularioInicial())
    setErrores({})
    setErrorGeneral(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, modelo])

  const cerrar = () => {
    if (guardando) return
    setFormulario(FORMULARIO_MODELO_VACIO)
    setErrores({})
    setErrorGeneral(null)
    onCerrar()
  }

  const cambiar = (campo: keyof FormularioModelo, valor: string) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined }))
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando) return
    const encontrados = validarModelo(formulario)
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) return
    setGuardando(true)
    try {
      if (modelo) await actualizarModelo(modelo, formulario)
      else await crearModelo(formulario)
      setFormulario(FORMULARIO_MODELO_VACIO)
      setErrores({})
      onGuardado()
    } catch (error) {
      if (esModeloRepetido(error)) {
        console.error('Modelo repetido.', error)
        setErrores({ modelo: MENSAJE_MODELO_REPETIDO })
      } else {
        setErrorGeneral(mensajeDeErrorService(error, modelo ? 'No pudimos guardar el modelo. Intentá de nuevo.' : 'No pudimos crear el modelo. Intentá de nuevo.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-modelo">
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-modelo" onCerrar={cerrar}>{modelo ? 'Editar modelo' : 'Nuevo modelo'}</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <TextField
              label="Equipo"
              value={formulario.equipo}
              onChange={(evento) => cambiar('equipo', evento.target.value)}
              placeholder="Nintendo Switch"
              required
              autoFocus
              error={Boolean(errores.equipo)}
              helperText={errores.equipo}
            />
            <TextField
              label="Modelo"
              value={formulario.modelo}
              onChange={(evento) => cambiar('modelo', evento.target.value)}
              placeholder="Switch 2"
              required
              error={Boolean(errores.modelo)}
              helperText={errores.modelo}
            />
            <TextField
              label="Mano de obra base"
              value={formulario.mano_obra_base}
              onChange={(evento) => cambiar('mano_obra_base', evento.target.value)}
              placeholder="25000"
              slotProps={{
                input: { endAdornment: <InputAdornment position="end">ARS</InputAdornment> },
                htmlInput: { inputMode: 'decimal' },
              }}
              error={Boolean(errores.mano_obra_base)}
              helperText={errores.mano_obra_base ?? 'Sin IVA.'}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? (modelo ? 'Guardando…' : 'Creando…') : modelo ? 'Guardar cambios' : 'Crear modelo'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
