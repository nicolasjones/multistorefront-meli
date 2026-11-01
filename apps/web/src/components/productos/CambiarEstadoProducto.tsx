import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { mensajeDeError } from '../../lib/productos'
import { supabaseClient } from '../../lib/supabase'

type Props = {
  id: string
  nombre: string
  activo: boolean
  onCambiado: () => void
  // Para avisar el error en el lugar que corresponda (ficha o fila de la grilla).
  onError: (mensaje: string | null) => void
}

// Activar / desactivar un producto (F-CAT-06, FR-015). Solo se monta para quien tiene
// edición en Productos; la autoridad es RLS dentro de public.cambiar_estado_producto.
// Desactivar no borra nada: el producto conserva datos, costo e imágenes.
export function CambiarEstadoProducto({ id, nombre, activo, onCambiado, onError }: Props) {
  const [enCurso, setEnCurso] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const accion = activo ? 'Desactivar' : 'Activar'

  const cambiar = async () => {
    setConfirmando(false)
    setEnCurso(true)
    onError(null)
    try {
      const { error } = await supabaseClient.rpc('cambiar_estado_producto', { p_id: id, p_activo: !activo })
      if (error) throw error
      onCambiado()
    } catch (error) {
      onError(mensajeDeError(error, `No pudimos ${activo ? 'desactivar' : 'activar'} el producto. Intentá de nuevo.`))
    } finally {
      setEnCurso(false)
    }
  }

  // Desactivar saca el producto de la venta y de las tiendas (MSF-627): pide confirmación. Activar es inocuo y va directo.
  return (
    <>
      <Button
        color={activo ? 'inherit' : 'primary'}
        variant="outlined"
        size="small"
        disabled={enCurso}
        onClick={() => (activo ? setConfirmando(true) : void cambiar())}
        aria-label={`${accion} ${nombre}`}
      >
        {accion}
      </Button>
      {activo ? (
        <Dialog open={confirmando} onClose={() => setConfirmando(false)} fullWidth maxWidth="xs" aria-labelledby="titulo-desactivar-producto">
          <TituloDialogo id="titulo-desactivar-producto" onCerrar={() => setConfirmando(false)}>
            ¿Desactivar el producto?
          </TituloDialogo>
          <DialogContent>
            <DialogContentText>
              {`«${nombre}» deja de ofrecerse en la venta y en las tiendas. No se borra nada: podés volver a activarlo cuando quieras.`}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button variant="contained" onClick={() => void cambiar()}>Desactivar</Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  )
}
