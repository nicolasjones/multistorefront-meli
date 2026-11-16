import { type FormEvent, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { type Gasto, MOTIVO_MAX, anularGasto, formatearImporteGasto, mensajeDeErrorGasto } from '../../lib/gastos'

type Props = { gasto: Gasto; onCerrar: () => void; onAnulado: () => void }

// «Anular» un gasto con motivo obligatorio (no hay borrado físico). El dueño lo monta y lo desmonta (también al cambiar la empresa activa).
export function DialogoAnularGasto({ gasto, onCerrar, onAnulado }: Props) {
  const [motivo, setMotivo] = useState('')
  const [intento, setIntento] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)
  const vacio = motivo.trim() === ''

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    setIntento(true)
    if (vacio || enCurso.current) return
    enCurso.current = true
    setGuardando(true)
    setError(null)
    try {
      await anularGasto(gasto.id, motivo.trim(), gasto.actualizadoEn)
      onAnulado()
    } catch (fallo) {
      setError(mensajeDeErrorGasto(fallo as { code?: string; message?: string }, 'No pudimos anular el gasto. Intentá de nuevo.'))
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-anular-gasto">
      <form onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id="titulo-anular-gasto" onCerrar={guardando ? undefined : onCerrar}>Anular gasto</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Typography>
              {`Vas a anular el gasto de ${gasto.categoria} por ${formatearImporteGasto(gasto.importe, gasto.moneda)}. Deja de contar en los totales y queda visible con «Mostrar anulados»; no se puede borrar.`}
            </Typography>
            <TextField
              label="Motivo de la anulación"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              error={intento && vacio}
              helperText={intento && vacio ? 'Contanos por qué se anula.' : undefined}
              required
              autoFocus
              slotProps={{ htmlInput: { maxLength: MOTIVO_MAX, autoComplete: 'off' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" color="error" disabled={guardando}>
            {guardando ? 'Anulando…' : 'Anular gasto'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
