import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  LARGO_MAXIMO_MOTIVO,
  anularReparacion,
  errorDeCampoDe,
  mensajeDeErrorReparacion,
  validarMotivoAnulacion,
  type Reparacion,
} from '../../lib/reparaciones'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  onCerrar: () => void
  onAnulada: (reparacion: Reparacion) => void
}

// Anulación con motivo obligatorio (FR-033). Es irreversible: el diálogo lo dice antes de confirmar.
export function AnularDialog({ abierto, reparacion, onCerrar, onAnulada }: Props) {
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setMotivo('')
    setErrorMotivo(null)
    setErrorGeneral(null)
  }, [abierto])

  const cerrar = () => {
    if (!guardando) onCerrar()
  }

  const anular = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando) return
    const invalido = validarMotivoAnulacion(motivo)
    setErrorMotivo(invalido)
    setErrorGeneral(null)
    if (invalido) {
      const formularioDom = evento.currentTarget as HTMLFormElement
      requestAnimationFrame(() => formularioDom.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setGuardando(true)
    try {
      onAnulada(await anularReparacion(reparacion.id, motivo))
    } catch (error) {
      const deCampo = errorDeCampoDe(error, ['motivo'] as const)
      if (deCampo) {
        console.error('La base rechazó el motivo de la anulación.', error)
        setErrorMotivo(deCampo.mensaje)
      } else {
        setErrorGeneral(mensajeDeErrorReparacion(error, 'No pudimos anular la reparación.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-anular-reparacion">
      <Box component="form" onSubmit={(evento) => void anular(evento)} noValidate>
        <TituloDialogo id="titulo-anular-reparacion" onCerrar={cerrar}>{`Anular ${reparacion.codigo}`}</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>
              La reparación queda marcada como anulada y de solo lectura. Esta acción no se puede deshacer.
            </DialogContentText>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <TextField
              label="Motivo de la anulación"
              required
              autoFocus
              multiline
              minRows={3}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value)
                setErrorMotivo(null)
              }}
              error={Boolean(errorMotivo)}
              helperText={errorMotivo}
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_MOTIVO } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" color="error" disabled={guardando}>{guardando ? 'Anulando…' : 'Anular reparación'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
