import { CircularProgress } from '@mui/material'
import { Navigate, useNavigate } from 'react-router'
import { DialogoInvitarUsuario } from '../../components/usuarios/DialogoInvitarUsuario'
import { usePuedeGestionarMembresias } from '../../hooks/usePuedeGestionarMembresias'

// Ruta /usuarios/create (la heredada /miembros/create redirige acá): abre el mismo diálogo «Invitar usuario» que el listado.
// Quien no puede gestionar usuarios vuelve al listado en vez de ver un formulario que el servidor rechazaría.
export function UsuarioCreate() {
  const navigate = useNavigate()
  const { puedeEscribir, isLoading } = usePuedeGestionarMembresias()
  if (isLoading) return <CircularProgress aria-label="Verificando permisos" sx={{ m: 4 }} />
  if (!puedeEscribir) return <Navigate to="/usuarios" replace />
  return <DialogoInvitarUsuario abierto onCerrar={() => navigate('/usuarios')} />
}
