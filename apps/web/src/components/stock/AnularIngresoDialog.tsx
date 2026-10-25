import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { useAnularIngreso } from '../../hooks/useAnularIngreso'
import {
  LARGO_MAXIMO_MOTIVO_ANULACION, mensajeDeErrorIngreso, validarMotivoAnulacion,
} from '../../lib/ingresos'

export type IngresoAAnular = {
  ingreso_id: string
  proveedor: string
  fecha: string
}

type Props = {
  abierto: boolean
  ingreso: IngresoAAnular | null
  onCerrar: () => void
  onAnulado: () => void
}

const MENSAJE_POR_DEFECTO = 'No pudimos anular el ingreso. Intentá de nuevo.'

// F-PRV-06: anulación con motivo obligatorio (3–500). La base revierte el stock por
// línea y rechaza todo si no alcanza; el diálogo solo muestra el resultado.
export function AnularIngresoDialog({ abierto, ingreso, onCerrar, onAnulado }: Props) {
  const [motivo, setMotivo] = useState('')
  const [intento, setIntento] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { anular, enviando } = useAnularIngreso()

  useEffect(() => {
    if (!abierto) return
    setMotivo('')
    setIntento(false)
    setError(null)
  }, [abierto, ingreso?.ingreso_id])

  const cerrar = () => {
    if (enviando) return
    onCerrar()
  }

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!ingreso || enviando) return
    setIntento(true)
    setError(null)
    const errorMotivo = validarMotivoAnulacion(motivo)
    if (errorMotivo) return

    const resultado = await anular(ingreso.ingreso_id, motivo)
    if (!resultado.ok) {
      setError(mensajeDeErrorIngreso(resultado.error, MENSAJE_POR_DEFECTO))
      return
    }
    onAnulado()
  }

  const errorMotivo = intento ? validarMotivoAnulacion(motivo) : null

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-anular-ingreso">
      <form onSubmit={(evento) => void confirmar(evento)} noValidate>
        <TituloDialogo id="titulo-anular-ingreso" onCerrar={cerrar}>Anular ingreso</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="bl">
              Se van a dar de baja las unidades del ingreso{ingreso ? ` de ${ingreso.proveedor} del ${ingreso.fecha.split('-').reverse().join('/')}` : ''}. El historial conserva la operación y no se puede deshacer.
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Motivo de la anulación"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              error={Boolean(errorMotivo)}
              helperText={errorMotivo ?? `${motivo.trim().length}/${LARGO_MAXIMO_MOTIVO_ANULACION}`}
              multiline
              minRows={2}
              autoFocus
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_MOTIVO_ANULACION } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
          <Button type="submit" color="warning" variant="contained" disabled={enviando}>
            {enviando ? 'Anulando…' : 'Anular ingreso'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
