import { useEffect, useState } from 'react'
import { etiquetaDeRol, resolverRolId } from '../lib/rolActual'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Nombre visible del rol de la persona en la organización de trabajo, para el mensaje de
// «Acceso restringido» de las pantallas solo-Administrador. Solo consulta cuando `activo`;
// si falla, devuelve el genérico. Devuelve null mientras no resolvió, para que la pantalla muestre
// carga en vez del literal «actual» por un instante.
export function useNombreRolActual(activo: boolean): string | null {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [nombre, setNombre] = useState<string | null>(null)

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    resolverRolId(organizacionId)
      .catch(() => '')
      .then((rolId) => { if (!cancelada) setNombre(etiquetaDeRol(rolId)) })
    return () => { cancelada = true }
  }, [activo, organizacionId])

  return nombre
}
