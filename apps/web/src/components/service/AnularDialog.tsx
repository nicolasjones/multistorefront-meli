import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, FormControlLabel, FormGroup, Stack, TextField, Typography } from '@mui/material'
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

export const AVISO_DEVOLUCION_ANULAR = 'Los repuestos descontados vuelven al stock, salvo los que marques como consumidos.'

// Anulación con motivo obligatorio (FR-033). Es irreversible: el diálogo lo dice antes de confirmar.
export function AnularDialog({ abierto, reparacion, onCerrar, onAnulada }: Props) {
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [consumidos, setConsumidos] = useState<Set<string>>(new Set())

  // Repuestos que salieron del stock y hoy pueden volver (F-SVC-11, FR-023).
  const descontados = (reparacion.items ?? []).filter((item) => item.tipo === 'repuesto' && item.stock_estado === 'descontado')

  useEffect(() => {
    if (!abierto) return
    setMotivo('')
    setErrorMotivo(null)
    setErrorGeneral(null)
    setConsumidos(new Set())
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
      onAnulada(await anularReparacion(reparacion.id, motivo, descontados.filter((item) => consumidos.has(item.id)).map((item) => item.id)))
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
            {descontados.length > 0 ? (
              <Stack spacing={0.5} role="group" aria-labelledby="titulo-repuestos-anular">
                <Typography id="titulo-repuestos-anular" variant="subtitle2">Repuestos descontados del stock</Typography>
                <Typography variant="caption" color="text.secondary">{AVISO_DEVOLUCION_ANULAR}</Typography>
                <FormGroup>
                  {descontados.map((item) => (
                    <FormControlLabel
                      key={item.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={consumidos.has(item.id)}
                          onChange={(evento) => {
                            const siguiente = new Set(consumidos)
                            if (evento.target.checked) siguiente.add(item.id)
                            else siguiente.delete(item.id)
                            setConsumidos(siguiente)
                          }}
                        />
                      }
                      label={`${item.cantidad} × ${item.descripcion}${item.deposito_nombre ? ` (${item.deposito_nombre})` : ''} · Consumido, no se devuelve`}
                    />
                  ))}
                </FormGroup>
              </Stack>
            ) : null}
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
