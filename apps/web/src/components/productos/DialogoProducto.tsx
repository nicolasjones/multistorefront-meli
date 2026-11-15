import { Dialog, DialogContent } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { AltaProducto } from '../../pages/productos/create'
import { EdicionProducto } from '../../pages/productos/edit'

type Props = {
  // null = producto nuevo.
  productoId: string | null
  onCerrar: () => void
  // Se creó o se guardó un producto: el listado se recarga desde el principio.
  onGuardado: () => void
}

// Popup «Nuevo producto» / «Editar producto» del listado (como «Nueva categoría»): el trabajo se hace sin salir de la
// pantalla y al cerrar se vuelve al listado tal como estaba. No se cierra con Esc ni al hacer clic afuera para no perder
// lo escrito: se sale con «Cancelar» (que pide confirmar si hay datos) o, ya guardado, con «Cerrar».
export function DialogoProducto({ productoId, onCerrar, onGuardado }: Props) {
  const titulo = productoId === null ? 'Nuevo producto' : 'Editar producto'
  return (
    <Dialog open fullWidth maxWidth="sm" scroll="paper" disableEscapeKeyDown onClose={() => undefined} aria-labelledby="dialogo-producto-titulo">
      <TituloDialogo id="dialogo-producto-titulo">{titulo}</TituloDialogo>
      <DialogContent dividers>
        {productoId === null ? (
          <AltaProducto onCancelar={onCerrar} onCreado={onGuardado} etiquetaSalir="Cerrar" />
        ) : (
          <EdicionProducto id={productoId} onCancelar={onCerrar} onGuardado={onGuardado} etiquetaSalir="Cerrar" />
        )}
      </DialogContent>
    </Dialog>
  )
}
