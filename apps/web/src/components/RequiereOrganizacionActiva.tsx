import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useIsSuperadmin } from '../hooks/useIsSuperadmin'
import { useOrganizacionActiva } from '../hooks/useOrganizacionActiva'
import { OrganizacionActivaBanner } from './OrganizacionActivaBanner'

// Defensa de UX (spec 004, FR-003) para quien llega por URL directa a una
// pantalla dependiente de organización sin pasar por el menú (que ya la
// oculta, ver providers/accessControlProvider.ts) — RLS ya rechaza el
// dato aunque esto fallara (spec 003), esto solo evita mostrar una lista
// vacía sin contexto. No afecta a administrador/miembro: ellos no tienen
// concepto de organización activa, así que este guard los deja pasar
// siempre (FR-008).
//
// También monta acá el indicador de organización activa (FR-004): así
// cualquier pantalla envuelta por este guard (list/create/edit de
// clientes, y mañana miembros) lo hereda gratis, en vez de repetirlo en
// cada ruta de App.tsx (mismo criterio de reutilización que research.md).
export function RequiereOrganizacionActiva({ children }: { children: ReactNode }) {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()
  const { organizacionActiva, isLoading: checkingOrganizacion } = useOrganizacionActiva()

  if (checkingSuperadmin || (isSuperadmin && checkingOrganizacion)) {
    return null
  }

  if (isSuperadmin && !organizacionActiva) {
    return <Navigate to="/organizaciones" replace />
  }

  return (
    <>
      <OrganizacionActivaBanner />
      {children}
    </>
  )
}
