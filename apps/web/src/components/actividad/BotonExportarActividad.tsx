import type { FiltrosActividad } from '../../lib/actividad'
import { useExportarActividad } from '../../hooks/useExportarActividad'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { ExportarCsvBoton } from '../stock/ExportarCsvBoton'

// Botón «Exportar» del encabezado de Actividad (F-AUD-03, FR-010). Solo lo ve quien tiene edición en
// Actividad y la acción `exportar` (la base lo vuelve a exigir con 42501): el Operador de solo lectura no
// lo ve (CA-AUD-03-2). Mientras no se sepa el permiso no se muestra, para que no aparezca y desaparezca.
export function BotonExportarActividad({ filtros }: { filtros: FiltrosActividad }) {
  const exportacion = useExportarActividad(filtros)
  const { nivel } = useNivelSeccion('actividad')
  const { puede } = usePuedeAccion('actividad', 'exportar')
  if (nivel !== 'edicion' || puede !== true) return null
  return <ExportarCsvBoton {...exportacion} />
}
