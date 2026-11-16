import { Chip } from '@mui/material'
import { useConsultasNuevas } from '../../hooks/useConsultas'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'

// Contador de consultas nuevas junto al ítem «Consultas» del menú (FR-005). Cuenta las de la
// empresa activa de la barra superior (todas las accesibles con «Todas mis empresas»), la misma
// cifra que «Nuevas (n)» de la bandeja. Sin valor vigente o en cero no se dibuja nada.
export function InsigniaConsultasNuevas() {
  const { empresaActivaId } = useEmpresasAccesibles()
  const { total } = useConsultasNuevas(empresaActivaId)
  if (!total) return null
  return (
    <Chip
      size="small"
      color="primary"
      label={total > 99 ? '99+' : total}
      aria-label={`${total} ${total === 1 ? 'consulta nueva' : 'consultas nuevas'}`}
    />
  )
}
