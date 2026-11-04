import { Dialog, DialogContent } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { AltaProducto } from '../../pages/productos/create'

type Props = {
  onCerrar: () => void
  // Se creó un producto: el listado se recarga desde el principio.
  onCreado: () => void
}

// Popup «Nuevo producto» del listado (como «Nueva categoría»): el alta se hace sin salir de la pantalla y al cerrar
// se vuelve al listado tal como estaba. No se cierra con Esc ni al hacer clic afuera para no perder lo escrito:
// se sale con «Cancelar» (que pide confirmar si hay datos) o, ya creado, con «Cerrar».
export function NuevoProductoDialog({ onCerrar, onCreado }: Props) {
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      scroll="paper"
      disableEscapeKeyDown
      onClose={() => undefined}
      aria-labelledby="nuevo-producto-titulo"
    >
      <TituloDialogo id="nuevo-producto-titulo">Nuevo producto</TituloDialogo>
      <DialogContent dividers>
        <AltaProducto onCancelar={onCerrar} onCreado={onCreado} etiquetaSalir="Cerrar" />
      </DialogContent>
    </Dialog>
  )
}
