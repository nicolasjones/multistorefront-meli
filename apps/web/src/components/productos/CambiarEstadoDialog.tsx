import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material'
import { useEjecutarEdicionMasiva } from '../../hooks/useEjecutarEdicionMasiva'
import { avisoResultado, cambiarEstadoProductos, productosN } from '../../lib/edicionMasiva'
import { supabaseClient } from '../../lib/supabase'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  ids: readonly string[]
  onCerrar: () => void
  onHecho: (aviso: string) => void
}

type Opcion = 'activar' | 'desactivar'

// «Cambiar estado» (F-CAT-12, FR-004): Activar / Desactivar con confirmación. Desactivar no borra nada.
// No está dibujado en el prototipo: mismo patrón de diálogo que «Mover de categoría».
export function CambiarEstadoDialog({ open, ids, onCerrar, onHecho }: Props) {
  const [opcion, setOpcion] = useState<Opcion | ''>('')
  const { enCurso, error, ejecutar, limpiarError } = useEjecutarEdicionMasiva()
  const cerrar = () => { if (!enCurso) { limpiarError(); onCerrar() } }

  const confirmar = async () => {
    if (opcion === '') return
    const activo = opcion === 'activar'
    const cambiados = await ejecutar(() => cambiarEstadoProductos(supabaseClient, ids, activo))
    if (cambiados === null) return
    onHecho(avisoResultado(cambiados, activo ? { singular: 'activado', plural: 'activados' } : { singular: 'desactivado', plural: 'desactivados' }))
  }

  return (
    <Dialog open={open} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-cambiar-estado">
      <TituloDialogo id="titulo-cambiar-estado" onCerrar={cerrar}>Cambiar estado</TituloDialogo>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          Elegí el estado para {productosN(ids.length)}. No se borra ningún dato ni imagen: un producto desactivado se puede volver a activar.
        </Typography>
        {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}
        <FormControl disabled={enCurso}>
          <FormLabel id="etiqueta-estado-masivo">Estado</FormLabel>
          <RadioGroup aria-labelledby="etiqueta-estado-masivo" value={opcion} onChange={(evento) => setOpcion(evento.target.value as Opcion)}>
            <FormControlLabel value="activar" control={<Radio />} label="Activar" />
            <FormControlLabel value="desactivar" control={<Radio />} label="Desactivar" />
          </RadioGroup>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={enCurso}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enCurso || opcion === ''}>
          {opcion === 'activar' ? `Activar ${productosN(ids.length)}` : opcion === 'desactivar' ? `Desactivar ${productosN(ids.length)}` : 'Confirmar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
