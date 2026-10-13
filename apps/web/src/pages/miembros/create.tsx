import { CircularProgress } from '@mui/material'
import { Navigate, useNavigate } from 'react-router'
import { DialogoInvitarUsuario } from '../../components/usuarios/DialogoInvitarUsuario'
import { usePuedeGestionarMembresias } from '../../hooks/usePuedeGestionarMembresias'

// Ruta heredada /miembros/create: abre el mismo diálogo «Invitar usuario» que el listado.
// Quien no puede gestionar usuarios vuelve al listado en vez de ver un formulario que el servidor rechazaría.
export function MiembroCreate() {
  const navigate = useNavigate()
  const { puedeEscribir, isLoading } = usePuedeGestionarMembresias()
  if (isLoading) return <CircularProgress aria-label="Verificando permisos" sx={{ m: 4 }} />
  if (!puedeEscribir) return <Navigate to="/miembros" replace />
  return <DialogoInvitarUsuario abierto onCerrar={() => navigate('/miembros')} />
}
