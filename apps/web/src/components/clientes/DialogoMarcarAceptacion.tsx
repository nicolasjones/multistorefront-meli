import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { marcarAceptacionCorreo, mensajeDeErrorAceptacion } from '../../lib/aceptacionCorreo'

type Props = {
  open: boolean
  clientes: readonly string[]
  onCerrar: () => void
  onMarcado: (cambiados: number, acepta: boolean) => void
}

// Diálogo «Marcar aceptación» (acción masiva del listado de Clientes, solo administrador): elige si los clientes
// seleccionados aceptan o no el correo masivo. La base registra quién y cuándo (Actividad). La selección es de la empresa
// activa del listado: el padre cierra el diálogo y la descarta al cambiar de empresa.
export function DialogoMarcarAceptacion({ open, clientes, onCerrar, onMarcado }: Props) {
  const [valor, setValor] = useState<'si' | 'no'>('si')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enVuelo = useRef(false)

  useEffect(() => {
    if (open) return
    setValor('si')
    setError(null)
  }, [open])

  const confirmar = async () => {
    if (enVuelo.current || clientes.length === 0) return
    enVuelo.current = true
    setEnviando(true)
    setError(null)
    try {
      const cambiados = await marcarAceptacionCorreo(clientes, valor === 'si')
      onMarcado(cambiados, valor === 'si')
    } catch (excepcion) {
      console.error('No pudimos marcar la aceptación de correo.', (excepcion as { code?: string } | null)?.code ?? 'sin código')
      setError(mensajeDeErrorAceptacion(excepcion, 'No pudimos marcar la aceptación. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onClose={enviando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-marcar-aceptacion">
      <TituloDialogo id="titulo-marcar-aceptacion" onCerrar={enviando ? undefined : onCerrar}>Marcar aceptación</TituloDialogo>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Vas a marcar a {clientes.length} {clientes.length === 1 ? 'cliente seleccionado' : 'clientes seleccionados'}. Queda registrado quién lo hizo y cuándo.
        </Typography>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        <FormControl>
          <FormLabel id="grupo-aceptacion">¿Aceptan recibir el correo masivo?</FormLabel>
          <RadioGroup aria-labelledby="grupo-aceptacion" value={valor} onChange={(evento) => setValor(evento.target.value as 'si' | 'no')}>
            <FormControlLabel value="si" control={<Radio />} label="Aceptan el correo masivo" disabled={enviando} />
            <FormControlLabel value="no" control={<Radio />} label="No aceptan el correo masivo" disabled={enviando} />
          </RadioGroup>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enviando || clientes.length === 0}>
          {enviando ? 'Marcando…' : 'Marcar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
