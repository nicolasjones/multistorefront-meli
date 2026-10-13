import { useEffect, useState, type ReactNode } from 'react'
import { useIsSuperadmin } from '../hooks/useIsSuperadmin'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { supabaseClient } from '../lib/supabase'
import { DESTINOS_PANEL } from './navegacion/destinosPanel'
import { AccesoRestringido } from '../pages/acceso-restringido/AccesoRestringido'

const ETIQUETA_ROL: Readonly<Record<string, string>> = {
  administrador: 'Administrador',
  miembro: 'Miembro',
  operador: 'Operador',
  consulta: 'Consulta',
  mostrador: 'Mostrador',
  deposito: 'Depósito',
  administracion: 'Administración',
}

function etiquetaSeccion(seccion: string): string {
  return DESTINOS_PANEL.find((destino) => destino.seccionPermiso === seccion)?.etiqueta ?? seccion
}

// F-ROL-03 (FR-008): quien llega por URL a una sección sin acceso ve
// AccesoRestringido en lugar de la sección. Los hijos no se montan, así que no
// se carga ningún dato de la sección (US2 criterio 4). Es defensa de UX: la
// autorización real es RLS. El superadmin sigue su camino (opera como
// administrador) y mientras carga no se muestra nada (deny-by-default).
export function RequiereAccesoSeccion({ seccion, children }: { seccion: string; children: ReactNode }) {
  const { isSuperadmin, isLoading: cargandoSuperadmin } = useIsSuperadmin()
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion(seccion)
  const denegado = !cargandoNivel && nivel === 'ninguno' && isSuperadmin === false
  const [rol, setRol] = useState<string | null>(null)

  useEffect(() => {
    if (!denegado) {
      return
    }
    let cancelada = false
    supabaseClient
      .from('usuarios_organizacion')
      .select('rol_id')
      .maybeSingle()
      .then(({ data }) => !cancelada && setRol(data?.rol_id ?? ''))
    return () => { cancelada = true }
  }, [denegado])

  if (cargandoSuperadmin || cargandoNivel) {
    return null
  }
  if (!denegado) {
    return <>{children}</>
  }
  if (rol === null) {
    return null
  }
  return <AccesoRestringido rol={ETIQUETA_ROL[rol] ?? 'actual'} seccion={etiquetaSeccion(seccion)} />
}
