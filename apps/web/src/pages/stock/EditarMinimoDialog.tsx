import { type FormEvent, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { useDefinirMinimo } from '../../hooks/useDefinirMinimo'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { EstadoError } from '../../components/estados/EstadosPagina'

type Props = {
  producto: { id: string; nombre: string; minimo: number }
  onCerrar: () => void
  onGuardado: () => void
}

// Edición del stock mínimo de un producto (F-STK-05, FR-015). Solo se monta para quien
// tiene edición en Stock; la autoridad es la RPC.
export default function EditarMinimoDialog({ producto, onCerrar, onGuardado }: Props) {
  const { definir, guardando } = useDefinirMinimo()
  const [texto, setTexto] = useState(String(producto.minimo))
  const [error, setError] = useState<string | null>(null)

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    const resultado = await definir(producto.id, texto)
    if (resultado === null) return
    if (resultado.ok) {
      onGuardado()
      onCerrar()
    } else {
      setError(resultado.mensaje)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-editar-minimo">
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-editar-minimo" onCerrar={onCerrar}>Stock mínimo</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{producto.nombre}</Typography>
            {error ? <EstadoError titulo="No pudimos guardar el mínimo." descripcion={error} /> : null}
            <TextField
              label="Cantidad mínima"
              value={texto}
              onChange={(evento) => { setTexto(evento.target.value); setError(null) }}
              helperText="Con esta cantidad o menos el producto se marca como stock bajo."
              autoFocus
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
