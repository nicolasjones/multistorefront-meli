import { useEffect, useState, type ReactNode } from 'react'
import { useIsSuperadmin } from '../hooks/useIsSuperadmin'
import { useOrganizacionDeTrabajo } from '../hooks/useOrganizacionDeTrabajo'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { ETIQUETA_ROL } from '../lib/permisos'
import { supabaseClient } from '../lib/supabase'
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
//
// `nivelMinimo` es el nivel de la sección que hace falta para entrar: 'lectura' (el default) abre con lectura o
// edición; 'edicion' deja pasar solo a quien puede escribir en la sección (pantallas que venden o editan).
export function RequiereAccesoSeccion({
  seccion,
  nivelMinimo = 'lectura',
  children,
}: {
  seccion: string
  nivelMinimo?: 'lectura' | 'edicion'
  children: ReactNode
}) {
  const { isSuperadmin, isLoading: cargandoSuperadmin } = useIsSuperadmin()
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion(seccion)
  const { organizacionId, isLoading: cargandoOrganizacion } = useOrganizacionDeTrabajo()
  const cargando = cargandoSuperadmin || cargandoNivel || cargandoOrganizacion
  // Falla cerrada: solo lectura/edicion abren la sección; un nivel nulo tras
  // cargar (error al resolver permisos) también se trata como denegado.
  const cumple = nivelMinimo === 'edicion' ? nivel === 'edicion' : nivel === 'lectura' || nivel === 'edicion'
  const denegado = !cargando && !cumple && isSuperadmin === false
  const [rol, setRol] = useState<string | null>(null)

  useEffect(() => {
    if (!denegado) {
      return
    }
    let cancelada = false
    // Si la consulta falla, se muestra la pantalla con un rol genérico: el
    // rol solo ilustra el mensaje y nunca debe dejar la pantalla en blanco.
    const resolver = async () => {
      const { data: sesion } = await supabaseClient.auth.getUser()
      const userId = sesion.user?.id
      // Sin organización activa no hay un rol que ilustrar: rol genérico.
      if (!userId || !organizacionId) {
        return ''
      }
      const { data, error } = await supabaseClient
        .from('usuarios_organizacion')
        .select('rol_id')
        .eq('user_id', userId)
        .eq('organizacion_id', organizacionId)
        .maybeSingle()
      return error ? '' : (data?.rol_id ?? '')
    }
    resolver()
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
  // Con edición exigida, el mensaje dice que falta ese nivel y no que la sección no existe para el rol.
  const etiqueta = nivelMinimo === 'edicion' ? `${etiquetaSeccion(seccion)} (edición)` : etiquetaSeccion(seccion)
  return <AccesoRestringido rol={ETIQUETA_ROL[rol ?? ''] ?? 'actual'} seccion={etiqueta} seccionClave={seccion} />
}
