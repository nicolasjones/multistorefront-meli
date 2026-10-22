import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  LARGO_MAXIMO_ENTREGADO_POR,
  errorDeCampoDe,
  formularioEntregaVacio,
  mensajeDeErrorReparacion,
  registrarEntregaReparacion,
  validarEntrega,
  type CampoEntrega,
  type ErroresEntrega,
  type FormularioEntrega,
  type Reparacion,
} from '../../lib/reparaciones'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  /** Estado con `cierra = true` elegido en el selector. */
  estado: { id: string; nombre: string } | null
  onCerrar: () => void
  onEntregada: (reparacion: Reparacion) => void
}

const CAMPOS: ReadonlyArray<CampoEntrega> = ['entrega_real', 'entregado_por']

// Diálogo de entrega (FR-032): se abre al elegir un estado que cierra. Fecha (no anterior al ingreso ni futura)
// y quién entregó, con error por campo y foco al primero inválido; la base repite las validaciones.
export function EntregaDialog({ abierto, reparacion, estado, onCerrar, onEntregada }: Props) {
  const [formulario, setFormulario] = useState<FormularioEntrega>(formularioEntregaVacio)
  const [errores, setErrores] = useState<ErroresEntrega>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setFormulario(formularioEntregaVacio())
    setErrores({})
    setErrorGeneral(null)
  }, [abierto])

  const cerrar = () => {
    if (!guardando) onCerrar()
  }

  const cambiar = (campo: CampoEntrega, valor: string) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined }))
  }

  const entregar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando || !estado) return
    const encontrados = validarEntrega(formulario, reparacion.ingreso_en)
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) {
      const formularioDom = evento.currentTarget as HTMLFormElement
      requestAnimationFrame(() => formularioDom.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setGuardando(true)
    try {
      onEntregada(await registrarEntregaReparacion(reparacion.id, estado.id, formulario))
    } catch (error) {
      const deCampo = errorDeCampoDe(error, CAMPOS)
      if (deCampo) {
        console.error('La base rechazó un dato de la entrega.', error)
        setErrores({ [deCampo.campo]: deCampo.mensaje })
      } else {
        setErrorGeneral(mensajeDeErrorReparacion(error, 'No pudimos registrar la entrega.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-entrega-reparacion">
      <Box component="form" onSubmit={(evento) => void entregar(evento)} noValidate>
        <TituloDialogo id="titulo-entrega-reparacion" onCerrar={cerrar}>
          {`Entrega · ${estado?.nombre ?? ''}`}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <TextField
              label="Fecha de entrega"
              type="date"
              required
              autoFocus
              value={formulario.entrega_real}
              onChange={(evento) => cambiar('entrega_real', evento.target.value)}
              error={Boolean(errores.entrega_real)}
              helperText={errores.entrega_real}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: reparacion.ingreso_en, max: formularioEntregaVacio().entrega_real } }}
            />
            <TextField
              label="Quién entregó"
              required
              value={formulario.entregado_por}
              onChange={(evento) => cambiar('entregado_por', evento.target.value)}
              error={Boolean(errores.entregado_por)}
              helperText={errores.entregado_por ?? 'Nombre de quien retira o recibe el equipo.'}
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_ENTREGADO_POR } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar entrega'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
