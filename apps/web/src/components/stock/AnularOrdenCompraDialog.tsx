import { type FormEvent, useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { useCambiarEstadoOrdenCompra } from '../../hooks/useOrdenesCompra'
import {
  LARGO_MAXIMO_MOTIVO_ANULACION, mensajeDeErrorOrden, validarMotivoAnulacion,
} from '../../lib/ordenesCompra'

export type OrdenAAnular = {
  orden_id: string
  proveedor: string
  fecha: string
}

type Props = {
  abierto: boolean
  orden: OrdenAAnular | null
  onCerrar: () => void
  onAnulada: () => void
}

const MENSAJE_POR_DEFECTO = 'No pudimos anular la orden. Intentá de nuevo.'

// F-PRV-09: anulación con motivo obligatorio (3–500). La base valida el estado de la
// orden y el motivo; el diálogo solo muestra el resultado.
export function AnularOrdenCompraDialog({ abierto, orden, onCerrar, onAnulada }: Props) {
  const [motivo, setMotivo] = useState('')
  const [intento, setIntento] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { cambiar, enviando } = useCambiarEstadoOrdenCompra()

  useEffect(() => {
    if (!abierto) return
    setMotivo('')
    setIntento(false)
    setError(null)
  }, [abierto, orden?.orden_id])

  const cerrar = () => {
    if (enviando) return
    onCerrar()
  }

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!orden || enviando) return
    setIntento(true)
    setError(null)
    if (validarMotivoAnulacion(motivo)) return

    const resultado = await cambiar(orden.orden_id, 'anulada', motivo)
    if (!resultado.ok) {
      setError(mensajeDeErrorOrden(resultado.error, MENSAJE_POR_DEFECTO))
      return
    }
    onAnulada()
  }

  const errorMotivo = intento ? validarMotivoAnulacion(motivo) : null

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-anular-orden-compra">
      <form onSubmit={(evento) => void confirmar(evento)} noValidate>
        <TituloDialogo id="titulo-anular-orden-compra" onCerrar={cerrar}>Anular orden de compra</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="bl">
              La orden{orden ? ` de ${orden.proveedor} del ${orden.fecha.split('-').reverse().join('/')}` : ''} se cancela y queda registrada con su motivo. No se puede deshacer.
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
            {enviando ? 'Anulando…' : 'Anular orden'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
