import type { ReactNode } from 'react'
import { useFeatureHabilitada } from '../../hooks/useFeatureHabilitada'
import { AccesoRestringido } from '../../pages/acceso-restringido/AccesoRestringido'
import { RequiereAccesoSeccion } from '../RequiereAccesoSeccion'
import { EstadoCargaPagina } from '../estados/EstadosPagina'

export const FUNCIONALIDAD_SERVICE_TECNICO = 'service-tecnico'

// FR-009: Service técnico se ofrece solo con la funcionalidad `service-tecnico` habilitada para la organización
// Y con acceso a la sección `service_tecnico`. Sin alguna de las dos → «Acceso restringido». Es defensa de UX: la
// autorización real de los datos es RLS (nivel de `service_tecnico`) en la base.
export function RequiereServiceTecnico({ children }: { children: ReactNode }) {
  return (
    <RequiereAccesoSeccion seccion="service_tecnico">
      <RequiereFuncionalidad>{children}</RequiereFuncionalidad>
    </RequiereAccesoSeccion>
  )
}

function RequiereFuncionalidad({ children }: { children: ReactNode }) {
  const { habilitada, isLoading } = useFeatureHabilitada(FUNCIONALIDAD_SERVICE_TECNICO)
  if (isLoading || habilitada === null) return <EstadoCargaPagina />
  // Falla cerrada: sin funcionalidad habilitada (o con error al consultarla) no se monta nada.
  if (!habilitada) return <AccesoRestringido rol="actual" seccion="Service técnico" />
  return <>{children}</>
}
