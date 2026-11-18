import { Link, TextField } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useDominioTienda } from '../../hooks/useDominioTienda'

// Dominio de la tienda en la ficha de la empresa (solo lectura): muestra el dominio vigente real; «Sin configurar»
// solo si de verdad no hay ninguno. Se administra desde la pestaña «Dominio y publicación» de la tienda (enlace).
export function CampoDominioEmpresa({ empresaId }: { empresaId: string }) {
  const { dominio, isLoading, isError } = useDominioTienda(empresaId)
  const valor = isLoading
    ? 'Cargando…'
    : isError
      ? 'No pudimos leerlo'
      : dominio?.dominioVigente ?? (dominio?.dominioPendiente ? `${dominio.dominioPendiente} (pendiente de verificar)` : 'Sin configurar')
  return (
    <TextField
      label="Dominio"
      value={valor}
      helperText={<>Se administra desde <Link component={RouterLink} to={`/empresas/${empresaId}/tienda/publicacion`}>Dominio y publicación</Link>.</>}
      disabled
      fullWidth
    />
  )
}
