import { useEffect, useState, type ReactNode } from 'react'
import { useIsSuperadmin } from '../hooks/useIsSuperadmin'
import { useOrganizacionDeTrabajo } from '../hooks/useOrganizacionDeTrabajo'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { etiquetaDeRol, resolverRolId } from '../lib/rolActual'
import { EstadoCargaPagina } from './estados/EstadosPagina'
import { DESTINOS_PANEL } from './navegacion/destinosPanel'
import { AccesoRestringido } from '../pages/acceso-restringido/AccesoRestringido'

function etiquetaSeccion(seccion: string): string {
  return DESTINOS_PANEL.find((destino) => destino.seccionPermiso === seccion)?.etiqueta ?? seccion
}

// F-ROL-03 (FR-008): quien llega por URL a una sección sin acceso ve
// AccesoRestringido en lugar de la sección. Los hijos no se montan, así que no
// se carga ningún dato de la sección (US2 criterio 4). Es defensa de UX: la
// autorización real es RLS. El superadmin sigue su camino (opera como
// administrador) y mientras carga se muestra el estado de carga compartido (deny-by-default).
export function RequiereAccesoSeccion({ seccion, children }: { seccion: string; children: ReactNode }) {
  const { isSuperadmin, isLoading: cargandoSuperadmin } = useIsSuperadmin()
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion(seccion)
  const { organizacionId, isLoading: cargandoOrganizacion } = useOrganizacionDeTrabajo()
  const cargando = cargandoSuperadmin || cargandoNivel || cargandoOrganizacion
  // Falla cerrada: solo lectura/edicion abren la sección; un nivel nulo tras
  // cargar (error al resolver permisos) también se trata como denegado.
  const denegado = !cargando && nivel !== 'lectura' && nivel !== 'edicion' && isSuperadmin === false
  const [rol, setRol] = useState<string | null>(null)

  useEffect(() => {
    if (!denegado) {
      return
    }
    let cancelada = false
    // Si la consulta falla, se muestra la pantalla con un rol genérico: el
    // rol solo ilustra el mensaje y nunca debe dejar la pantalla en blanco.
    resolverRolId(organizacionId)
      .catch(() => '')
      .then((valor) => { if (!cancelada) setRol(valor) })
    return () => { cancelada = true }
  }, [denegado, organizacionId])

  if (cargando || (denegado && rol === null)) {
    return <EstadoCargaPagina />
  }
  if (!denegado) {
    return <>{children}</>
  }
  return <AccesoRestringido rol={etiquetaDeRol(rol ?? '')} seccion={etiquetaSeccion(seccion)} seccionClave={seccion} />
}
