import { useState } from 'react'
import { Button } from '@mui/material'
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
  const accion = activo ? 'Desactivar' : 'Activar'

  const cambiar = async () => {
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

  return (
    <Button
      color={activo ? 'inherit' : 'primary'}
      variant="outlined"
      size="small"
      disabled={enCurso}
      onClick={() => void cambiar()}
      aria-label={`${accion} ${nombre}`}
    >
      {accion}
    </Button>
  )
}
