import { Dialog, DialogContent } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { AltaCliente } from '../../pages/clientes/create'
import { EdicionCliente } from '../../pages/clientes/edit'

type Props = {
  // null = cliente nuevo.
  clienteId: string | null
  onCerrar: () => void
  // Creado o guardado: el listado se recarga y muestra el aviso.
  onGuardado: (mensaje: string) => void
}

// Popup «Nuevo cliente» / «Editar cliente» del listado: se trabaja sin salir de la pantalla y al cerrar se vuelve al
// listado tal como estaba. No se cierra con Esc ni al hacer clic afuera para no perder lo escrito: se sale con «Cancelar».
export function DialogoCliente({ clienteId, onCerrar, onGuardado }: Props) {
  const titulo = clienteId === null ? 'Nuevo cliente' : 'Editar cliente'
  return (
    <Dialog open fullWidth maxWidth="md" scroll="paper" disableEscapeKeyDown onClose={() => undefined} aria-labelledby="dialogo-cliente-titulo">
      <TituloDialogo id="dialogo-cliente-titulo">{titulo}</TituloDialogo>
      <DialogContent dividers>
        {clienteId === null ? (
          <AltaCliente onCancelar={onCerrar} alCrear={(_id, mensaje) => onGuardado(mensaje)} />
        ) : (
          <EdicionCliente id={clienteId} onCancelar={onCerrar} alGuardar={onGuardado} />
        )}
      </DialogContent>
    </Dialog>
  )
}
