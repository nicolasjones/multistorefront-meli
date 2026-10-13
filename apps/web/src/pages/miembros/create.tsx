import { useNavigate } from 'react-router'
import { DialogoInvitarUsuario } from '../../components/usuarios/DialogoInvitarUsuario'

// Ruta heredada /miembros/create: abre el mismo diálogo «Invitar usuario» que el listado.
export function MiembroCreate() {
  const navigate = useNavigate()
  return <DialogoInvitarUsuario abierto onCerrar={() => navigate('/miembros')} />
}
